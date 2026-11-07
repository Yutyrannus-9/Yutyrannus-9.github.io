import deepMeta from '../../data/brain/deep.json';

// Names and notes for the deep structures, kept free of three.js so the HUD can
// use them without pulling the 3D chunk into the first load.
export type DeepStructure = (typeof deepMeta.structures)[number];
export const deepById = new Map(deepMeta.structures.map((s) => [s.id, s]));
export const DEEP = deepMeta;
