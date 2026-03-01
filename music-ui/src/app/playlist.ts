export interface Playlist {
    album: string;
    artist: string;
    cat_num: string;
    composer: string;
    conductor: string;
    date: string; // YYYY-MM-DD
    icon_path: string;
    image_url: string; // full URL to image without https:
    in_key: string;
    info_url_line_2: string;
    info_url_line_3: string;
    label: string;
    label_num: string;
    line_1: string;
    line_2: string;
    line_3: string;
    link_path: string;
    opus: string;
    orchestra: string;
    runtime: string; // HH:MM:SS
    schedule_id: number;
    soloist1: string;
    soloist2: string;
    soloist3: string;
    soloist4: string;
    soloist5: string;
    soloist6: string;
    time: string; // HH:MM:SS
    title: string;
    audioStartPosition?: number; // Position in audio stream (seconds) where this track started
}