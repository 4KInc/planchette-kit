// Figures table of requirements.md, as data. Labels and values are copied exactly.

export type FigureRowId =
  | 'fitts-method'
  | 'head-tp-hmd'
  | 'head-we-hmd'
  | 'head-tp-phone'
  | 'head-tp-mobile'
  | 'min-jerk'
  | 'tremor-freq-pathological'
  | 'tremor-physiological'
  | 'tremor-parkinson'
  | 'tremor-intention'
  | 'head-tremor-et'
  | 'head-tremor-cd'
  | 'head-tremor-deg'
  | 'min-head-range'
  | 'ref-head-range';

export interface FigureRow {
  id: FigureRowId;
  label: string;
  value: string;
  refs: readonly number[];
}

export const FIGURES: Readonly<Record<FigureRowId, FigureRow>> = {
  'fitts-method': {
    id: 'fitts-method',
    label: "Fitts' law, Shannon formulation; effective width We = 4.133 × SD of end points; throughput = IDe / MT",
    value: "method",
    refs: [1, 2],
  },
  'head-tp-hmd': {
    id: 'head-tp-hmd',
    label: "Head pointing throughput, people without motor impairments, head-mounted display (41 people; mean over click and dwell groups; 300 ms dwell in the dwell group)",
    value: "2.47 bits/s (mouse 3.24, gaze 2.13); time to activate 850 ms. Upper bound, context only: not used by a preset.",
    refs: [3],
  },
  'head-we-hmd': {
    id: 'head-we-hmd',
    label: "Head effective width, same study",
    value: "about 72 px (about 2.5 degrees). Used for the scatter cap. Derivation: SD = We / 4.133 = 72 / 4.133 = 17.4 px; 2.5 / 4.133 = 0.6 degrees.",
    refs: [3],
  },
  'head-tp-phone': {
    id: 'head-tp-phone',
    label: "Head pointing throughput with a phone's front camera",
    value: "0.61 bits/s with motor impairments, 0.90 bits/s without; IDs 1.62–5.20 bits",
    refs: [4],
  },
  'head-tp-mobile': {
    id: 'head-tp-mobile',
    label: "Head pointing throughput, mobile head tracker",
    value: "1.42 bits/s. Used by `steady`.",
    refs: [5],
  },
  'min-jerk': {
    id: 'min-jerk',
    label: "Minimum-jerk movement path",
    value: "method",
    refs: [6],
  },
  'tremor-freq-pathological': {
    id: 'tremor-freq-pathological',
    label: "Frequency of most pathological tremors",
    value: "4–8 Hz",
    refs: [7],
  },
  'tremor-physiological': {
    id: 'tremor-physiological',
    label: "Physiological tremor",
    value: "8–12 Hz",
    refs: [7],
  },
  'tremor-parkinson': {
    id: 'tremor-parkinson',
    label: "Parkinsonian rest tremor",
    value: "4–7 Hz",
    refs: [7],
  },
  'tremor-intention': {
    id: 'tremor-intention',
    label: "Intention (cerebellar) tremor",
    value: "below 5 Hz",
    refs: [7],
  },
  'head-tremor-et': {
    id: 'head-tremor-et',
    label: "Head tremor, essential tremor (n = 78)",
    value: "peak 4.25 ± 0.88 Hz; 12.3 ± 15.3 deg/s between successive extrema",
    refs: [8],
  },
  'head-tremor-cd': {
    id: 'head-tremor-cd',
    label: "Head tremor, cervical dystonia (n = 96)",
    value: "peak 4.37 ± 1.22 Hz; 7.77 ± 6.72 deg/s",
    refs: [8],
  },
  'head-tremor-deg': {
    id: 'head-tremor-deg',
    label: "Head tremor size in degrees (derived)",
    value: "ET mean ≈ 0.46° peak to peak; CD mean ≈ 0.28°. \"ET mean + 2 SD = 1.6°\" is chosen, not a percentile, because the SD exceeds the mean.",
    refs: [8],
  },
  'min-head-range': {
    id: 'min-head-range',
    label: "Minimum supported head range",
    value: "±3°",
    refs: [],
  },
  'ref-head-range': {
    id: 'ref-head-range',
    label: "Reference head range",
    value: "±15°",
    refs: [],
  },
};

export interface Reference {
  citation: string;
  url?: string;
}

export const REFERENCES: Readonly<Record<number, Reference>> = {
  1: {
    citation: "Soukoreff RW, MacKenzie IS. Towards a standard for pointing device evaluation, perspectives on 27 years of Fitts' law research in HCI. *International Journal of Human-Computer Studies* 61 (2004) 751–789.",
  },
  2: {
    citation: "MacKenzie IS. Fitts' law as a research and design tool in human-computer interaction. *Human-Computer Interaction* 7 (1992) 91–139.",
  },
  3: {
    citation: "Hansen JP, Rajanna V, MacKenzie IS, Bækgaard P. A Fitts' law study of click and dwell interaction by gaze, head and mouse with a head-mounted display. COGAIN @ ETRA 2018. doi:10.1145/3206343.3206344.",
    url: "https://www.yorku.ca/mack/etra2018.html",
  },
  4: {
    citation: "Cicek M, Dave A, Feng W, Huang MX, Haines JK, Nichols J. Designing and evaluating head-based pointing on smartphones for people with motor impairments. ASSETS 2020. doi:10.1145/3373625.3416994.",
    url: "https://research.google/pubs/designing-and-evaluating-head-based-pointing-on-smartphones-for-people-with-motor-impairments/",
  },
  5: {
    citation: "Roig-Maimó MF, MacKenzie IS, Manresa-Yee C, Varona J. Head-tracking interfaces on mobile devices: evaluation using Fitts' law and a new multi-directional corner task for small displays. *International Journal of Human-Computer Studies* 112 (2018) 1–15. doi:10.1016/j.ijhcs.2017.12.003.",
    url: "https://www.yorku.ca/mack/ijhcs2018.html",
  },
  6: {
    citation: "Flash T, Hogan N. The coordination of arm movements: an experimentally confirmed mathematical model. *Journal of Neuroscience* 5(7) (1985) 1688–1703.",
  },
  7: {
    citation: "Bhatia KP et al. Consensus statement on the classification of tremors, from the Task Force on Tremor of the International Parkinson and Movement Disorder Society. *Movement Disorders* 33(1) (2018) 75–87. doi:10.1002/mds.27121.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6530552/",
  },
  8: {
    citation: "Berbakov L, Jovanović Č, Svetel M, Vasiljević J, Dimić G, Radulović N. Quantitative assessment of head tremor in patients with essential tremor and cervical dystonia by using inertial sensors. *Sensors* 19(19) (2019) 4246. doi:10.3390/s19194246.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6806605/",
  },
};

export type ParamSource =
  | { kind: 'figure'; row: FigureRowId; ref: number; note?: string }
  | { kind: 'chosen'; reason: string };

export interface Sourced<T> {
  value: T;
  source: ParamSource;
}
