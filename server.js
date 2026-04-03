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
      .sort((a, b) => b.count - a.count)
      .map((t) => t.name.toLowerCase())
      .filter((g) => !junkTags.has(g) && g.length > 3 && findGenreScore(g) !== null)
      .slice(0, 3); // Only keep top 3 most-voted genre tags

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

  // Sort breakdown to find top genres
  breakdown.sort((a, b) => b.weight - a.weight);

  // Blend: 60% weighted average + 40% top-3 genre average
  // This prevents regression to the mean by letting dominant genres pull harder
  const weightedAvg = weightedSum / matchedWeight;
  const top3 = breakdown.slice(0, 3);
  const top3Avg = top3.reduce((sum, g) => sum + g.score, 0) / top3.length;
  let baseIQ = weightedAvg * 0.6 + top3Avg * 0.4;

  const modifiers = [];

  const uniqueGenres = genres.length;
  if (uniqueGenres > 20) {
    modifiers.push({ name: "Genre diversity", value: 6 });
    baseIQ += 6;
  } else if (uniqueGenres > 10) {
    modifiers.push({ name: "Genre diversity", value: 3 });
    baseIQ += 3;
  } else if (uniqueGenres <= 4) {
    modifiers.push({ name: "One-trick pony", value: -5 });
    baseIQ -= 5;
  }

  // Echo chamber penalty
  const topGenreWeight = Math.max(...genres.map(([, c]) => c)) / totalCount;
  if (topGenreWeight > 0.7) {
    modifiers.push({ name: "Echo chamber", value: -6 });
    baseIQ -= 6;
  } else if (topGenreWeight > 0.5) {
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
    modifiers.push({ name: "Instrumental bonus", value: 5 });
    baseIQ += 5;
  } else if (instrumentalWeight > 0.15) {
    modifiers.push({ name: "Instrumental bonus", value: 3 });
    baseIQ += 3;
  }

  // Basic tax: top 3 genres are all mainstream
  const basicGenres = ["pop", "dance pop", "edm", "hip hop", "rap", "trap",
    "teen pop", "boy band", "bubblegum pop", "reggaeton", "country pop"];
  const top3Genres = breakdown.slice(0, 3).map((g) => g.genre);
  if (top3Genres.every((g) => basicGenres.some((bg) => g.includes(bg)))) {
    modifiers.push({ name: "Basic tax", value: -8 });
    baseIQ -= 8;
  }

  // Pretentiousness bonus: heavy experimental/art presence
  const pretentious = ["experimental", "avant-garde", "art rock", "art pop",
    "free jazz", "math rock", "post-rock", "chamber pop", "baroque pop",
    "minimalism", "idm", "noise", "no wave", "krautrock"];
  const pretWeight = genres
    .filter(([g]) => pretentious.some((pg) => g.includes(pg)))
    .reduce((sum, [, c]) => sum + c, 0) / totalCount;
  if (pretWeight > 0.3) {
    modifiers.push({ name: "Pretentiousness bonus", value: 8 });
    baseIQ += 8;
  } else if (pretWeight > 0.15) {
    modifiers.push({ name: "Pretentiousness bonus", value: 4 });
    baseIQ += 4;
  }

  // Cosmic variance
  const randomOffset = Math.round((Math.random() - 0.5) * 8);
  modifiers.push({ name: "Cosmic variance", value: randomOffset });
  baseIQ += randomOffset;

  baseIQ = Math.max(60, Math.min(150, Math.round(baseIQ)));

  return { iq: baseIQ, breakdown: breakdown.slice(0, 15), modifiers };
}

function getTags(breakdown, topArtists, artistTrackCounts, genreCounts) {
  const tags = [];
  const topArtist = topArtists[0] || "Unknown";
  const topArtistCount = artistTrackCounts[topArtist] || 0;
  const allGenres = Object.entries(genreCounts);
  const totalCount = allGenres.reduce((sum, [, c]) => sum + c, 0);

  // Helper: what % of genres match a list
  function genreWeight(genreList) {
    return allGenres
      .filter(([g]) => genreList.some((gl) => g.includes(gl)))
      .reduce((sum, [, c]) => sum + c, 0) / totalCount;
  }

  // 1. Top artist tag
  tags.push({ label: `${topArtist} lover`, type: "artist" });

  // 2. Top genre tag
  if (breakdown[0]) {
    tags.push({ label: breakdown[0].genre, type: "genre" });
  }

  // 3. Vibe tags based on genre mix
  const vibeMap = [
    { tag: "Edgy", genres: ["metal", "industrial", "death metal", "black metal", "hardcore", "noise", "deathcore", "thrash"] },
    { tag: "Peppy", genres: ["dance pop", "electropop", "teen pop", "bubblegum pop", "k-pop", "euro", "synth-pop"] },
    { tag: "Serious", genres: ["classical", "orchestral", "opera", "chamber music", "contemporary classical", "minimalism"] },
    { tag: "Mysterious", genres: ["darkwave", "goth", "trip hop", "ambient", "shoegaze", "dream pop", "post-punk"] },
    { tag: "Playful", genres: ["ska", "funk", "disco", "nu-disco", "reggae", "surf rock", "bossa nova"] },
    { tag: "Gritty", genres: ["grunge", "blues", "garage rock", "punk", "hardcore punk", "stoner rock", "southern rock"] },
    { tag: "Whimsical", genres: ["indie folk", "freak folk", "chamber pop", "baroque pop", "art pop", "celtic"] },
    { tag: "Intense", genres: ["post-rock", "progressive rock", "progressive metal", "math rock", "post-hardcore", "screamo"] },
    { tag: "Goofy", genres: ["comedy", "ska punk", "pop punk", "novelty", "parody", "hyperpop"] },
    { tag: "Brooding", genres: ["emo", "midwest emo", "slowcore", "doom metal", "post-rock", "sadcore"] },
    { tag: "Energetic", genres: ["edm", "drum and bass", "house", "techno", "trance", "dubstep", "hard rock", "punk rock"] },
    { tag: "Laid-back", genres: ["lo-fi", "chillwave", "downtempo", "acoustic", "bossa nova", "smooth jazz", "reggae"] },
    { tag: "Dramatic", genres: ["symphonic metal", "opera", "orchestral", "musical theater", "broadway", "post-rock"] },
    { tag: "Quirky", genres: ["art rock", "experimental", "idm", "krautrock", "no wave", "glitch", "vaporwave"] },
    { tag: "Stoic", genres: ["ambient", "minimalism", "drone", "meditation", "new age", "early music"] },
    { tag: "Chaotic", genres: ["noise", "free jazz", "avant-garde", "experimental", "death metal", "grindcore", "hyperpop"] },
  ];

  // Score each vibe and pick top 2-3
  const vibeScores = vibeMap
    .map((v) => ({ tag: v.tag, weight: genreWeight(v.genres) }))
    .filter((v) => v.weight > 0.05)
    .sort((a, b) => b.weight - a.weight);

  for (const vibe of vibeScores.slice(0, 2)) {
    tags.push({ label: vibe.tag, type: "vibe" });
  }

  // 4. Diversity tag
  const uniqueGenres = allGenres.length;
  if (uniqueGenres > 20) {
    tags.push({ label: "Eclectic", type: "trait" });
  } else if (uniqueGenres <= 4) {
    tags.push({ label: "Tunnel vision", type: "trait" });
  }

  // 5. Decade/era feeling based on genre associations
  const retroGenres = ["classic rock", "motown", "disco", "soul", "funk", "blues rock", "psychedelic rock", "swing", "big band"];
  const modernGenres = ["hyperpop", "trap", "edm", "dubstep", "cloud rap", "vaporwave", "synthwave"];
  const retroW = genreWeight(retroGenres);
  const modernW = genreWeight(modernGenres);
  if (retroW > 0.2) tags.push({ label: "Old soul", type: "trait" });
  if (modernW > 0.2) tags.push({ label: "Chronically online", type: "trait" });

  // 6. Mainstream vs underground
  const mainstreamGenres = ["pop", "dance pop", "hip hop", "rap", "r&b", "country", "edm", "teen pop"];
  const undergroundGenres = ["experimental", "noise", "free jazz", "avant-garde", "math rock", "idm", "no wave", "shoegaze"];
  const mainW = genreWeight(mainstreamGenres);
  const underW = genreWeight(undergroundGenres);
  if (mainW > 0.4) tags.push({ label: "Mainstream", type: "trait" });
  else if (underW > 0.15) tags.push({ label: "Underground", type: "trait" });

  // 7. Top artist devotion
  if (topArtistCount >= 10) {
    tags.push({ label: "Obsessive", type: "trait" });
  }

  return tags;
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

    result.tags = getTags(result.breakdown, topArtists, artistCounts, genreCounts);
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
