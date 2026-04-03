require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

const genreScores = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data", "genre-scores.json"), "utf-8")
);

// Cache MusicBrainz artist lookups to avoid repeated requests
const artistGenreCache = new Map();

function extractPlaylistId(input) {
  const urlMatch = input.match(/playlist\/([a-zA-Z0-9]{22})(?:\?|$|\/)/);
  if (urlMatch) return urlMatch[1];

  const uriMatch = input.match(/spotify:playlist:([a-zA-Z0-9]{22})/);
  if (uriMatch) return uriMatch[1];

  if (/^[a-zA-Z0-9]{22}$/.test(input.trim())) return input.trim();

  return null;
}

async function getPlaylistFromEmbed(playlistId) {
  const res = await fetch(
    `https://open.spotify.com/embed/playlist/${playlistId}`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    }
  );

  if (!res.ok) throw new Error(`Failed to fetch playlist (${res.status})`);

  const html = await res.text();
  const match = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
  );
  if (!match) throw new Error("Could not parse playlist data");

  const nextData = JSON.parse(match[1]);
  const entity = nextData.props.pageProps.state.data.entity;

  return {
    name: entity.name,
    image: entity.coverArt?.sources?.[0]?.url || null,
    tracks: entity.trackList.map((t) => ({
      title: t.title,
      artist: t.subtitle,
      uri: t.uri,
    })),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getArtistGenres(artistName) {
  // Check cache first
  if (artistGenreCache.has(artistName)) {
    return artistGenreCache.get(artistName);
  }

  try {
    const res = await fetch(
      `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(artistName)}&fmt=json&limit=1`,
      {
        headers: { "User-Agent": "SpotifyIQ/1.0 (spotify-iq-app)" },
      }
    );

    if (!res.ok) {
      artistGenreCache.set(artistName, []);
      return [];
    }

    const data = await res.json();
    const artist = data.artists?.[0];

    if (!artist || !artist.tags) {
      artistGenreCache.set(artistName, []);
      return [];
    }

    // Filter out non-genre junk tags from MusicBrainz
    const junkTags = new Set([
      "american", "british", "english", "australian", "canadian", "german",
      "french", "swedish", "japanese", "korean", "irish", "scottish",
      "norwegian", "icelandic", "finnish", "italian", "spanish", "brazilian",
      "uk", "us", "usa", "britannique",
      "male vocalists", "female vocalists", "singer", "rapper", "producer",
      "band", "solo", "duo", "supergroup", "ensemble",
      "1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s",
      "1992-1998", "21st century",
      "grammy winner", "grammy", "bootleg", "live", "remix",
      "c\u2019\u00e9tait mieux avant", "sacred cows", "relic inn",
      "fascist", "antisemite", "nazi", "pro trump",
      "parlophone", "warp", "4ad", "sub pop", "matador",
      "oxford", "london", "new york", "los angeles", "seattle", "chicago",
      "england", "germany", "france", "sweden", "japan", "norway", "iceland",
      "nude", "vyrzukhisuc-artiest", "new grave",
    ]);

    const genres = artist.tags
      .filter((t) => t.count > 0)
      .map((t) => t.name.toLowerCase())
      .filter((g) => !junkTags.has(g) && g.length > 3 && findGenreScore(g) !== null);

    artistGenreCache.set(artistName, genres);
    return genres;
  } catch {
    artistGenreCache.set(artistName, []);
    return [];
  }
}

function findGenreScore(genre) {
  if (genreScores[genre] !== undefined) return genreScores[genre];

  const lowerGenre = genre.toLowerCase();
  let bestMatch = null;
  let bestLength = 0;

  for (const key of Object.keys(genreScores)) {
    if (key.startsWith("_")) continue;
    if (lowerGenre.includes(key) && key.length > bestLength) {
      bestMatch = key;
      bestLength = key.length;
    }
  }

  if (bestMatch) return genreScores[bestMatch];

  for (const key of Object.keys(genreScores)) {
    if (key.startsWith("_")) continue;
    if (key.includes(lowerGenre)) return genreScores[key];
  }

  return null;
}

function calculateIQ(genreCounts) {
  const genres = Object.entries(genreCounts);
  if (genres.length === 0) return { iq: 100, breakdown: [], modifiers: [] };

  const totalCount = genres.reduce((sum, [, count]) => sum + count, 0);
  let weightedSum = 0;
  let matchedWeight = 0;
  const breakdown = [];

  for (const [genre, count] of genres) {
    const score = findGenreScore(genre);
    const weight = count / totalCount;

    if (score !== null) {
      weightedSum += score * weight;
      matchedWeight += weight;
      breakdown.push({ genre, count, score, weight });
    }
  }

  if (matchedWeight === 0) return { iq: 100, breakdown: [], modifiers: [] };

  let baseIQ = weightedSum / matchedWeight;
  const modifiers = [];

  const uniqueGenres = genres.length;
  if (uniqueGenres > 20) {
    modifiers.push({ name: "Genre diversity", value: 4 });
    baseIQ += 4;
  } else if (uniqueGenres > 10) {
    modifiers.push({ name: "Genre diversity", value: 2 });
    baseIQ += 2;
  }

  // Echo chamber penalty
  const topGenreWeight = Math.max(...genres.map(([, c]) => c)) / totalCount;
  if (topGenreWeight > 0.7) {
    modifiers.push({ name: "Echo chamber", value: -3 });
    baseIQ -= 3;
  }

  // Instrumental bonus: post-rock, ambient, classical, soundtrack, etc.
  const instrumentalGenres = [
    "post-rock", "ambient", "classical", "orchestral", "soundtrack",
    "instrumental", "instrumental rock", "chamber music", "minimalism",
    "drone", "new age", "meditation", "neo-classical",
  ];
  const instrumentalWeight = genres
    .filter(([g]) => instrumentalGenres.some((ig) => g.includes(ig)))
    .reduce((sum, [, c]) => sum + c, 0) / totalCount;
  if (instrumentalWeight > 0.3) {
    modifiers.push({ name: "Instrumental bonus", value: 3 });
    baseIQ += 3;
  } else if (instrumentalWeight > 0.15) {
    modifiers.push({ name: "Instrumental bonus", value: 1 });
    baseIQ += 1;
  }

  // Cosmic variance
  const randomOffset = Math.round((Math.random() - 0.5) * 4);
  modifiers.push({ name: "Cosmic variance", value: randomOffset });
  baseIQ += randomOffset;

  baseIQ = Math.max(60, Math.min(150, Math.round(baseIQ)));
  breakdown.sort((a, b) => b.weight - a.weight);

  return { iq: baseIQ, breakdown: breakdown.slice(0, 15), modifiers };
}

function getVerdicts(iq, breakdown, topArtists) {
  const topGenre = breakdown[0]?.genre || "music";
  const secondGenre = breakdown[1]?.genre || null;
  const topArtist = topArtists[0] || "that one artist";
  const secondArtist = topArtists[1] || "various artists";

  // Pool of comments per IQ range — pick 3 each time
  const pools = {
    genius: [
      "You listen to music that doesn't even have lyrics. We get it.",
      `Your ${topGenre} phase never ended — it became a personality.`,
      "You've corrected someone on the difference between post-rock and post-punk.",
      `You've described ${topArtist} as 'criminally underrated' at a party.`,
      "Your playlist would clear a room at any normal gathering.",
      "You own at least one album on vinyl that you've never actually played.",
      `Listening to ${topArtist} doesn't make you deep, but we'll let you have this one.`,
      "You've unironically used the word 'soundscape' in conversation.",
    ],
    high: [
      "Your playlist is the sonic equivalent of a turtleneck at a house party.",
      `Heavy ${topGenre} presence — you've definitely argued about this genre online.`,
      "You've described an album as 'sonically rich' at least once.",
      `${topArtist} fans always think they're smarter than they are. Exhibit A.`,
      "You have strong opinions about Pitchfork reviews.",
      `Your mix of ${topGenre} and ${secondGenre || "other stuff"} says 'I contain multitudes.'`,
      "Someone has called your music taste 'interesting' and you took it as a compliment.",
      `You've recommended ${topArtist} to someone who did not ask.`,
    ],
    mid: [
      "Perfectly balanced, as all things should be. Basic, but self-aware.",
      `${topArtist} is carrying your entire IQ score right now.`,
      "You sing in the car and you're not sorry about it.",
      `Your ${topGenre} taste is the musical equivalent of a default ringtone.`,
      "You've said 'I listen to everything' and meant about 3 genres.",
      `Without ${topArtist}, this playlist would be in trouble.`,
      "Your music taste peaked in high school and you're at peace with that.",
      `${topGenre} and ${secondGenre || "pop"} — the peanut butter and jelly of basic playlists.`,
    ],
    low: [
      "Your playlist is a vibe. Not a thought, but definitely a vibe.",
      `You listen to ${topArtist} with the windows down. Everyone heard.`,
      "You don't listen to music to think. You listen to music to FEEL.",
      `Your ${topGenre} heavy playlist tells us everything we need to know.`,
      "Your speakers have never once played anything in a minor key.",
      `${topArtist} appreciates your streams, if nothing else.`,
      "You've never once Googled the lyrics to understand a song. Respect.",
      `${secondArtist || topArtist} is doing a lot of heavy lifting here.`,
    ],
  };

  let pool;
  if (iq >= 125) pool = pools.genius;
  else if (iq >= 108) pool = pools.high;
  else if (iq >= 90) pool = pools.mid;
  else pool = pools.low;

  // Shuffle and pick 3
  const shuffled = pool.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 3);
}

// Routes
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

app.get("/api/analyze", async (req, res) => {
  // SSE for streaming progress
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const playlistUrl = req.query.url;
    if (!playlistUrl) {
      send("error", { error: "Playlist URL is required" });
      return res.end();
    }

    const playlistId = extractPlaylistId(playlistUrl);
    if (!playlistId) {
      send("error", { error: "Invalid Spotify playlist URL" });
      return res.end();
    }

    // Step 1: Get tracks from Spotify embed page
    send("progress", { stage: "Fetching playlist...", percent: 0 });
    const playlist = await getPlaylistFromEmbed(playlistId);
    console.log(
      `Playlist: "${playlist.name}", ${playlist.tracks.length} tracks`
    );

    // Step 2: Get unique artist names
    const uniqueArtists = [...new Set(playlist.tracks.map((t) => t.artist))];
    send("progress", {
      stage: `Found ${uniqueArtists.length} artists to analyze`,
      percent: 5,
    });

    // Step 3: Fetch genres from MusicBrainz (rate limited: 1 req/sec)
    const genreCounts = {};
    let processed = 0;

    for (const artistName of uniqueArtists) {
      const genres = await getArtistGenres(artistName);

      const artistTrackCount = playlist.tracks.filter(
        (t) => t.artist === artistName
      ).length;

      for (const genre of genres) {
        genreCounts[genre] = (genreCounts[genre] || 0) + artistTrackCount;
      }

      processed++;
      const percent = 5 + Math.round((processed / uniqueArtists.length) * 90);
      send("progress", {
        stage: `Analyzing ${artistName}...`,
        percent,
        current: processed,
        total: uniqueArtists.length,
      });

      // MusicBrainz rate limit: 1 request per second
      if (!artistGenreCache.has(artistName)) {
        await sleep(1000);
      }
    }

    console.log(`Found ${Object.keys(genreCounts).length} unique genres`);

    // Step 4: Calculate IQ
    send("progress", { stage: "Calculating your IQ...", percent: 98 });
    const result = calculateIQ(genreCounts);

    const artistCounts = {};
    for (const t of playlist.tracks) {
      artistCounts[t.artist] = (artistCounts[t.artist] || 0) + 1;
    }
    const topArtists = Object.entries(artistCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name]) => name);

    result.verdicts = getVerdicts(result.iq, result.breakdown, topArtists);
    result.playlistName = playlist.name;
    result.trackCount = playlist.tracks.length;
    result.artistCount = uniqueArtists.length;
    result.playlistImage = playlist.image;

    send("result", result);
    res.end();
  } catch (err) {
    console.error("Analysis error:", err);
    send("error", { error: err.message });
    res.end();
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Spotify IQ running on port ${PORT}`);
});
