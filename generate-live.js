import fs from "fs";
import fetch from "node-fetch";
import axios from "axios";

/*
  generate-live.js (FINAL: H+1 Dynamic Grouping & Single Static Group with FORCE HEADER)
  - Fetches soccer events (H+0 to H+1) for dynamic grouping.
  - Channels with live football matches move to ⚽ LIVE FOOTBALL [Tanggal].
  - All other channels (non-football, non-live football) fall into 🌟 SPORTS GLOBAL & UMUM.
  - Global duplicate naming is applied.
  - FIX: Ensures H+0 and H+1 headers appear even if empty.
*/

const SOURCE_M3US = [
  
  "https://bakulwifi.my.id/live.m3u"
  // Tambahkan URL live untuk nyolong.m3u di sini jika sudah ada
];

// =======================================================
// HELPER FUNCTIONS
// =======================================================

function getDateString(daysOffset) {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset); 
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function fetchText(url) {
  try {
    const res = await fetch(url, { timeout: 15000 });
    if (!res.ok) return "";
    return await res.text();
  } catch (e) {
    console.log("fetchText error for", url, e.message);
    return "";
  }
}

function extractChannelsFromM3U(m3u) {
  const lines = m3u.split(/\r?\n/);
  const channels = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.startsWith("#EXTINF")) {
      const nameMatch = l.match(/,(.*)$/);
      const namePart = nameMatch ? nameMatch[1].trim() : l;

      const url = (lines[i + 1] || "").trim();
      if (url.startsWith("http")) {
        channels.push({ extinf: l, name: namePart, url });
      }
    }
  }
  return channels;
}

function loadChannelMap() {
  try {
    const raw = fs.readFileSync("./channel-map.json", "utf8"); 
    return JSON.parse(raw);
  } catch (e) {
    console.log("channel-map.json missing or invalid, using empty map:", e.message);
    return {};
  }
}

// Mengambil Jadwal Sepak Bola 2 Hari ke Depan (H+0 hingga H+1)
async function fetchUpcomingEvents() {
    let allEvents = [];
    
    // LOOP HINGGA H+1 (offset <= 1)
    for (let offset = 0; offset <= 1; offset++) {
        const date = getDateString(offset);
        const url = `https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${date}&s=Soccer`;
        const txt = await fetchText(url);
        
        try {
            const events = (JSON.parse(txt).events || []).map(ev => ({
                sport: "Soccer", 
                event: ev.strEvent ? ev.strEvent.toLowerCase() : '',
                title: ev.strEvent, 
                home: ev.strHomeTeam ? ev.strHomeTeam.toLowerCase() : '',
                away: ev.strAwayTeam ? ev.strAwayTeam.toLowerCase() : '',
                league: ev.strLeague ? ev.strLeague.toLowerCase() : '',
                time: ev.strTime || '', 
                date: date, 
                offset: offset 
            }));
            allEvents = allEvents.concat(events);
        } catch (e) {
            // Error parsing diabaikan
        }
    }
    return allEvents;
}


function getStaticCategory(channel, channelMap) {
  const ln = channel.name.toLowerCase();
  const lu = channel.url.toLowerCase();
  
  for (const category of Object.keys(channelMap)) {
    const keywordsArray = channelMap[category];
    
    if (Array.isArray(keywordsArray)) {
      for (const kw of keywordsArray) {
        if (typeof kw === 'string') {
          const k = kw.toLowerCase();
          
          const cleanLn = ln.replace(/ -[0-9]+$/, '').trim(); 
          
          if (cleanLn.includes(k) || lu.includes(k)) {
            return category; 
          }
        }
      }
    }
  }

  return null;
}

// Mencari Informasi Acara Live/Upcoming Sepak Bola (H+1) untuk Suffix Nama
function getEventMatchInfo(channel, events) {
    const ln = channel.name.toLowerCase();
    const lu = channel.url.toLowerCase();
    let bestMatch = null;
    let bestOffset = Infinity; 
    
    for (const ev of events) {
        const matchesTeams = (ev.home && (ln.includes(ev.home) || lu.includes(ev.home))) || 
                             (ev.away && (ln.includes(ev.away) || lu.includes(ev.away)));
        const matchesEventName = (ev.event && (ln.includes(ev.event) || lu.includes(ev.event)));
        const matchesLeague = (ev.league && (ln.includes(ev.league) || lu.includes(ev.league)));
        
        if (matchesTeams || matchesEventName || matchesLeague) {
            if (ev.offset <= bestOffset) { 
                bestOffset = ev.offset;
                bestMatch = ev;
            }
        }
    }
    
    if (bestMatch) {
        const timePart = bestMatch.time ? ` (${bestMatch.time.substring(0, 5)} WIB)` : '';
        const datePart = bestMatch.date;
        const status = bestMatch.offset === 0 ? "LIVE TODAY" : datePart;
        
        // Format Detail: | [Status/Tanggal - Liga - Waktu] Pertandingan
        const suffix = ` | [${status} - ${bestMatch.league}${timePart}] ${bestMatch.title}`;

        return { suffix: suffix, isLive: bestMatch.offset === 0, dateGroup: `⚽ LIVE FOOTBALL ${datePart}` };
    }
    
    return null;
}


async function main() {
  console.log("Starting generate-live.js (H+1 Dynamic Grouping, Single Fallback)...");
  
  const output = []; 
  const FALLBACK_GROUP = "🌟 SPORTS GLOBAL & UMUM";
  const LIVE_FOOTBALL_PREFIX = "⚽ LIVE FOOTBALL";

  const channelMap = loadChannelMap();
  const events = await fetchUpcomingEvents(); 
  
  let allChannels = [];
  for (const src of SOURCE_M3US) {
    const m3u = await fetchText(src);
    if (!m3u) continue;
    allChannels = allChannels.concat(extractChannelsFromM3U(m3u));
  }

  const uniqueSet = new Set();
  const unique = allChannels.filter(c => {
    if (!uniqueSet.has(c.url)) {
      uniqueSet.add(c.url);
      return true;
    }
    return false;
  });

  let matchedCount = 0;

  // =========================================================================
  // TAHAP 1: PEMETAAN DAN PENYEMATAN DETAIL JADWAL
  // =========================================================================
  
  const processedChannels = [];

  for (const ch of unique) {
    
    const staticCategory = getStaticCategory(ch, channelMap);
    
    if (!staticCategory) continue; 
    
    let groupTitle = FALLBACK_GROUP; // Default: Semua masuk ke Global & Umum
    let finalChannelName = ch.name;
    let isLive = false;
    
    // Cek apakah saluran ini adalah saluran Bola
    if (staticCategory === "FOOTBALL") { 
        const eventMatchInfo = getEventMatchInfo(ch, events);
        
        if (eventMatchInfo) {
            finalChannelName += eventMatchInfo.suffix;
            groupTitle = eventMatchInfo.dateGroup; // Ganti grup ke tanggal dinamis (H+1)
            isLive = eventMatchInfo.isLive;
        } 
        // Jika saluran Football tidak live, ia akan tetap di groupTitle = FALLBACK_GROUP
    } else {
        // Saluran Non-Football (BASKET, WWE, dll) juga masuk ke FALLBACK_GROUP
        // finalChannelName tetap nama aslinya
    }
    
    matchedCount++;
    
    // Simpan saluran ke list sementara
    processedChannels.push({
        name: finalChannelName,
        url: ch.url,
        groupTitle: groupTitle, // Bisa dinamis (Tanggal) atau statis (FALLBACK)
        originalCategory: staticCategory, // Kategori asli untuk sorting internal
        isLive: isLive
    });
  }

  // =========================================================================
  // TAHAP 2: PENOMORAN NAMA DUPLIKAT GLOBAL
  // =========================================================================
  
  const nameCountMap = new Map();
  const finalOutputChannels = [];

  for (const ch of processedChannels) {
      const baseNameKey = ch.name.split(' | ')[0]; 
      
      const count = nameCountMap.get(baseNameKey) || 0;
      nameCountMap.set(baseNameKey, count + 1);

      let displayName = ch.name;
      
      // Jika count > 0, artinya ini adalah duplikat kedua, ketiga, dst.
      if (count > 0) {
          // Tambahkan penomoran di akhir NAMA SALURAN ASLI
          let suffixJadwal = '';
          const suffixMatch = ch.name.match(/ \| \[.*\] .*/);
          if (suffixMatch) {
              suffixJadwal = suffixMatch[0];
          }

          displayName = `${baseNameKey} -${count}${suffixJadwal}`; 
      }
      
      // Tambahkan tag [LIVE] jika sedang live hari ini (H+0)
      if (ch.isLive) {
          displayName = `${displayName} [LIVE]`;
      }

      finalOutputChannels.push({
          ...ch,
          name: displayName
      });
  }
  
  // =========================================================================
  // TAHAP 3: OUTPUT AKHIR (Dengan Force Header)
  // =========================================================================
  
  const outputMap = new Map();
  
  // Inisialisasi semua grup yang mungkin
  const dateGroups = [getDateString(0), getDateString(1)]; 
  dateGroups.forEach(date => {
      outputMap.set(`${LIVE_FOOTBALL_PREFIX} ${date}`, []);
  });
  outputMap.set(FALLBACK_GROUP, []); // Grup statis Fallback

  for (const ch of finalOutputChannels) {
      if(outputMap.has(ch.groupTitle)) {
          outputMap.get(ch.groupTitle).push(ch);
      } else {
          outputMap.get(FALLBACK_GROUP).push(ch);
      }
  }

  output.push("#EXTM3U");
  
  const sortedGroups = Array.from(outputMap.keys()).sort((a, b) => {
      // Prioritas 1: Grup LIVE FOOTBALL (Tanggal) di atas
      if (a.startsWith(LIVE_FOOTBALL_PREFIX) && b.startsWith(LIVE_FOOTBALL_PREFIX)) {
          return a.localeCompare(b);
      }
      if (a.startsWith(LIVE_FOOTBALL_PREFIX)) return -1; 
      if (b.startsWith(LIVE_FOOTBALL_PREFIX)) return 1;
      
      // Prioritas 2: Grup Statis (Fallback) selalu di bawah
      return 1;
  });

  for (const groupTitle of sortedGroups) {
      const channelsInGroup = outputMap.get(groupTitle);
      
      // FORCE HEADER: Tuliskan grup dinamis terlepas dari isinya
      if (groupTitle.startsWith(LIVE_FOOTBALL_PREFIX)) {
          // Tuliskan header grup dinamis
          output.push(`\n#EXTINF:-1 group-title=\"${groupTitle}\",--- ${groupTitle} ---`);
          output.push("https://separator.channel.available/offline.m3u8");

          if (channelsInGroup.length === 0) {
               // Tampilkan placeholder jika grup tanggal kosong
               output.push(`#EXTINF:-1 group-title=\"${groupTitle}\",[NO LIVE MATCHES FOUND FOR THIS DATE]`);
               output.push("https://placeholder.channel.available/offline.m3u8");
          } else {
              // Tulis saluran yang cocok
              channelsInGroup.sort((a, b) => a.name.localeCompare(b.name));
              for (const ch of channelsInGroup) {
                  const newExtinf = `#EXTINF:-1 group-title=\"${groupTitle}\",${ch.name}`;
                  output.push(newExtinf); 
                  output.push(ch.url);
              }
          }
      } else if (channelsInGroup.length > 0) {
          // --- Grup Statis (FALLBACK) ---
          
          // Tuliskan header grup statis
          output.push(`\n#EXTINF:-1 group-title=\"${groupTitle}\",--- ${groupTitle} ---`);
          output.push("https://separator.channel.available/offline.m3u8");

          channelsInGroup.sort((a, b) => a.name.localeCompare(b.name));
          for (const ch of channelsInGroup) {
              const newExtinf = `#EXTINF:-1 group-title=\"${groupTitle}\",${ch.name}`;
              output.push(newExtinf); 
              output.push(ch.url);
          }
      }
  }

  fs.writeFileSync("live-auto.m3u", output.join("\n") + "\n");
  
  const stats = {
    fetched: allChannels.length,
    unique: unique.length,
    matched: matchedCount,
    generatedAt: new Date().toISOString()
  };

  fs.writeFileSync("live-auto-stats.json", JSON.stringify(stats, null, 2));

  console.log("=== SUMMARY ===\nTotal unique channels:", unique.length, "\nMatched (categories/schedule):", matchedCount, "\nGenerated live-auto.m3u with", finalOutputChannels.length, "channels (including offline)\nStats saved to live-auto-stats.json");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
