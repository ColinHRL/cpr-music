export type StationId = 'indie' | 'classical' | 'news';

export interface Station {
  id: StationId;
  name: string;
  tabTitle: string;
  siteUrl: string;
  playlistUrl: string;
  streamUrls: string[];
}

export const STATIONS: Record<StationId, Station> = {
  indie: {
    id: 'indie',
    name: 'CPR Music',
    tabTitle: 'Indie - CPR',
    siteUrl: 'https://www.cpr.org/indie/',
    playlistUrl: 'https://playlist.cprnetwork.org/won_plus3/KVOQ.json',
    streamUrls: [
      'https://stream.cprnetwork.org/cpr3_lo',
      'https://stream1.cprnetwork.org/cpr3_lo',
      'https://stream2.cprnetwork.org/cpr3_lo',
    ],
  },
  classical: {
    id: 'classical',
    name: 'CPR Classical',
    tabTitle: 'Classical - CPR',
    siteUrl: 'https://www.cpr.org/classical/',
    playlistUrl: 'https://playlist.cprnetwork.org/won_plus3/KVOD.json',
    streamUrls: [
      'https://stream.cprnetwork.org/cpr2_lo',
      'https://stream1.cprnetwork.org/cpr2_lo',
      'https://stream2.cprnetwork.org/cpr2_lo',
    ],
  },
  news: {
    id: 'news',
    name: 'CPR News',
    tabTitle: 'News - CPR',
    siteUrl: 'https://www.cpr.org/',
    playlistUrl: 'https://playlist.cprnetwork.org/won_plus3/KCFR.json',
    streamUrls: [
      'https://stream.cprnetwork.org/cpr1_lo',
      'https://stream1.cprnetwork.org/cpr1_lo',
      'https://stream2.cprnetwork.org/cpr1_lo',
    ],
  },
};
