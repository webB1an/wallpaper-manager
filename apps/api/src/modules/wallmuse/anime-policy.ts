// Only dedicated SFW anime/illustration providers are offered by WallMuse.
export const animeSources = ["nekos_best", "waifu_im", "nekosia", "safebooru", "nekos_moe", "nekos_api", "nekos_life", "pic_re"];
export function isAnimeSource(id: string) { return animeSources.includes(id); }
