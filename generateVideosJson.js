import fs from "fs";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const API_KEY = process.env.YOUTUBE_API_KEY || "AIzaSyBJhAOSP4h56n-l1V60zlE_uWtNrKvwhmY";
const CHANNEL_ID = "UCi__qHBfHLlYg0fu86BUA8g";
const MAX_RESULTS_PER_PAGE = 50;
const MAX_PAGES = 20;
const PUBLISHED_AFTER = "2024-01-01T00:00:00Z";

async function getVideos() {
  try {
    let allVideos = [];
    let nextPageToken = null;
    let pageCount = 0;
    
    console.log('🎬 Fetching all videos from Black Room YouTube channel...');
    console.log(`📅 Fetching videos from: ${PUBLISHED_AFTER}`);
    
    while (pageCount < MAX_PAGES) {
      let url = `https://www.googleapis.com/youtube/v3/search?key=${API_KEY}&channelId=${CHANNEL_ID}&part=snippet&type=video&order=date&maxResults=${MAX_RESULTS_PER_PAGE}&publishedAfter=${PUBLISHED_AFTER}`;
      
      if (nextPageToken) {
        url += `&pageToken=${nextPageToken}`;
      }
      
      const res = await fetch(url);
      const data = await res.json();

      if (!data.items || data.items.length === 0) {
        if (data.error) {
          console.error("❌ YouTube API Error:", data.error.message);
        }
        break;
      }

      const videos = data.items.map((v) => ({
        id: v.id.videoId,
        title: v.snippet.title,
        thumbnail: v.snippet.thumbnails.medium.url,
        publishedAt: v.snippet.publishedAt
      }));
      
      allVideos = allVideos.concat(videos);
      console.log(`📦 Page ${pageCount + 1}: Got ${videos.length} videos (Total: ${allVideos.length})`);
      
      nextPageToken = data.nextPageToken;
      pageCount++;
      
      if (!nextPageToken) {
        console.log('✅ No more pages available');
        break;
      }
      
      await new Promise(r => setTimeout(r, 100));
    }

    if (allVideos.length === 0) {
      console.error("❌ No videos found. Check API KEY or CHANNEL ID.");
      return;
    }

    const path = "./public/data/videos.json";
    fs.mkdirSync("./public/data", { recursive: true });
    fs.writeFileSync(path, JSON.stringify(allVideos, null, 2));
    console.log(`\n✅ Saved ${allVideos.length} videos to ${path}`);
    console.log(`📊 Date range: ${new Date(PUBLISHED_AFTER).toLocaleDateString()} - Now`);
    
  } catch (err) {
    console.error("❌ Error generating videos.json:", err);
  }
}

getVideos();
