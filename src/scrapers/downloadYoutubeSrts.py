#!/usr/bin/env python3
"""
downloadYoutubeSrts.py

Downloads YouTube video captions/subtitles in .srt format using yt-dlp.
Reads video URLs from a CSV file and saves .srt files to a captions directory.

Usage:
    python downloadYoutubeSrts.py [csv_file] [captions_dir]

Arguments:
    csv_file       : Path to CSV file containing YouTube video URLs (optional)
                     Default: Uses MIT_BRAIN environment variable
    captions_dir   : Directory to save .srt files (optional)
                     Default: ../input/captions

Requirements:
    pip install yt-dlp --break-system-packages

Example:
    python downloadYoutubeSrts.py ../brain/mit_brain_test17.csv
    python downloadYoutubeSrts.py ../brain/mit_brain_test17.csv ../input/captions
"""

import sys
import os
import subprocess
import csv
import re

def get_video_id(url):
    """Extract video ID from YouTube URL"""
    if not url or not isinstance(url, str):
        return None
    
    patterns = [
        r'(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)',
        r'youtube\.com\/embed\/([^&\s]+)',
        r'youtube\.com\/v\/([^&\s]+)'
    ]
    
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    
    return None

def download_captions(video_url, video_id, output_dir='captions', language='en'):
    """Download captions using yt-dlp"""
    
    # Check if caption already exists
    expected_file = os.path.join(output_dir, f"{video_id}.{language}.srt")
    if os.path.exists(expected_file):
        return True, f"Caption file already exists"
    
    # Ensure output directory exists
    os.makedirs(output_dir, exist_ok=True)
    
    # Output filename base (yt-dlp will add .{lang}.srt)
    output_base = os.path.join(output_dir, video_id)
    
    # Build yt-dlp command
    cmd = [
        'yt-dlp',
        '--skip-download',
        '--write-subs',
        '--write-auto-subs',
        '--sub-lang', language,
        '--sub-format', 'srt',
        '--convert-subs', 'srt',
        '-o', output_base,
        video_url
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        
        if result.returncode == 0 and os.path.exists(expected_file):
            return True, f"Downloaded"
        else:
            return False, f"No captions available"
            
    except subprocess.TimeoutExpired:
        return False, f"Timeout"
    except Exception as e:
        return False, f"Error: {str(e)}"

def process_csv(csv_file, captions_dir='captions', url_column='url'):
    """Process CSV file and download captions for all YouTube videos"""
    print("=" * 60)
    print("YouTube Caption Downloader")
    print("=" * 60)
    print(f"Input CSV: {csv_file}")
    print(f"Captions Directory: {captions_dir}")
    print("=" * 60)
    
    # Check if yt-dlp is installed
    try:
        subprocess.run(['yt-dlp', '--version'], 
                      capture_output=True, 
                      check=True,
                      timeout=5)
    except:
        print("\n❌ Error: yt-dlp is not installed")
        print("Install with: pip install yt-dlp --break-system-packages")
        return False
    
    # Read CSV file
    print("\n📄 Reading CSV file...")
    try:
        with open(csv_file, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            rows = list(reader)
        print(f"📊 Loaded {len(rows)} rows from CSV")
    except Exception as e:
        print(f"❌ Error reading CSV: {e}")
        return False
    
    # Check if required columns exist
    if len(rows) > 0 and url_column not in rows[0]:
        print(f"❌ Column '{url_column}' not found in CSV")
        print(f"Available columns: {', '.join(rows[0].keys())}")
        return False
    
    # Filter for YouTube videos
    print("\n🔍 Filtering for YouTube videos...")
    
    has_kind_source = len(rows) > 0 and 'kind' in rows[0] and 'source' in rows[0]
    has_fulltext = len(rows) > 0 and 'fullText' in rows[0]
    
    if has_kind_source:
        filtered_rows = [
            row for row in rows 
            if row.get('kind') == 'video' and row.get('source') == 'YouTube'
        ]
        print(f"   Filtered: kind='video' AND source='YouTube'")
    else:
        filtered_rows = [row for row in rows if row.get(url_column)]
        print(f"   Note: 'kind' and 'source' columns not found, processing all URLs")
    
    total_videos = len(filtered_rows)
    
    # OPTIMIZATION: Skip videos that already have captions loaded in brain
    if has_fulltext:
        videos_needing_captions = [
            row for row in filtered_rows
            if not row.get('fullText') or row.get('fullText').strip() == ''
        ]
        already_have_captions = total_videos - len(videos_needing_captions)
        
        if already_have_captions > 0:
            print(f"   ⏭️  Skipping {already_have_captions} videos (fullText already populated in brain)")
        
        filtered_rows = videos_needing_captions
    
    video_count = len(filtered_rows)
    print(f"🔹 Found {video_count} YouTube videos needing captions")
    
    if video_count == 0:
        print("\n✅ All videos already have captions loaded in the brain!")
        return True
    
    # Download captions
    print(f"\n🎬 Downloading captions...\n")
    
    success_count = 0
    skip_count = 0
    error_count = 0
    
    for idx, row in enumerate(filtered_rows, start=1):
        url = row.get(url_column)
        
        if not url:
            continue
        
        video_id = get_video_id(url)
        if not video_id:
            print(f"  ⚠️  [{idx}/{video_count}] Invalid URL")
            error_count += 1
            continue
        
        print(f"  [{idx}/{video_count}] {video_id}...", end=" ")
        
        success, message = download_captions(url, video_id, captions_dir)
        
        if success:
            if "already exists" in message:
                print(f"⭐ Skipped (exists)")
                skip_count += 1
            else:
                print(f"✅ {message}")
                success_count += 1
        else:
            print(f"❌ {message}")
            error_count += 1
    
    # Summary
    print("\n" + "=" * 60)
    print("📊 Summary:")
    print(f"   Total YouTube videos in brain: {total_videos}")
    print(f"   Videos needing captions: {video_count}")
    print(f"   Downloaded: {success_count}")
    print(f"   Skipped (file exists): {skip_count}")
    print(f"   Errors: {error_count}")
    print("=" * 60)
    
    return True

def main():
    # Get configuration from environment or defaults
    brain_dir = os.getenv('BRAIN_DIR', '../brain')
    input_dir = os.getenv('INPUT_DIR', '../input')
    brain_name = os.getenv('MIT_BRAIN', 'mit_brain')
    
    # CSV file is in brain directory (generated by MITBrainSchema)
    csv_file = sys.argv[1] if len(sys.argv) > 1 else f'{brain_dir}/{brain_name}.csv'
    
    # Captions go in input directory with other source files
    captions_dir = sys.argv[2] if len(sys.argv) > 2 else f'{input_dir}/captions'
    
    if not os.path.exists(csv_file):
        print(f"❌ File not found: {csv_file}")
        print(f"\nExpected CSV at: {csv_file}")
        print(f"\nMake sure:")
        print(f"1. BRAIN_DIR is set correctly (current: {brain_dir})")
        print(f"2. MIT_BRAIN is set correctly (current: {brain_name})")
        print(f"3. Scrapers have run and created the CSV file")
        sys.exit(1)
    
    success = process_csv(csv_file, captions_dir)
    
    if success:
        print("\n🎉 Processing complete!")
        sys.exit(0)
    else:
        print("\n❌ Processing failed")
        sys.exit(1)

if __name__ == '__main__':
    main()