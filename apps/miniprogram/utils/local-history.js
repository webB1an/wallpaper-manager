"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveDownloadHistory = saveDownloadHistory;
exports.readDownloadHistory = readDownloadHistory;
exports.replaceDownloads = replaceDownloads;
exports.toggleFavorite = toggleFavorite;
exports.setFavoritePresence = setFavoritePresence;
exports.isFavorite = isFavorite;
exports.readFavorites = readFavorites;
exports.replaceFavorites = replaceFavorites;
const DOWNLOAD_KEY = "wallpaper_downloaded_history";
const FAVORITE_KEY = "wallpaper_favorite_list";
function readList(key) {
    const value = wx.getStorageSync(key);
    return Array.isArray(value) ? value : [];
}
function writeList(key, list) {
    wx.setStorageSync(key, list.slice(0, 50));
}
function saveDownloadHistory(item) {
    if (!item || !item.title)
        return;
    const next = [
        { id: item.id, title: item.title, coverUrl: item.coverUrl, at: Date.now() },
        ...readList(DOWNLOAD_KEY),
    ].slice(0, 50);
    writeList(DOWNLOAD_KEY, next);
}
function readDownloadHistory() {
    return readList(DOWNLOAD_KEY);
}
function replaceDownloads(list) {
    writeList(DOWNLOAD_KEY, list);
}
function toggleFavorite(item) {
    const list = readList(FAVORITE_KEY);
    if (item.id && list.some((record) => record.id === item.id)) {
        writeList(FAVORITE_KEY, list.filter((record) => record.id !== item.id));
        return false;
    }
    writeList(FAVORITE_KEY, [{ id: item.id, title: item.title, coverUrl: item.coverUrl, at: Date.now() }, ...list]);
    return true;
}
function setFavoritePresence(item, on) {
    const list = readList(FAVORITE_KEY).filter((record) => record.id !== item.id);
    if (on)
        writeList(FAVORITE_KEY, [{ id: item.id, title: item.title, coverUrl: item.coverUrl, at: Date.now() }, ...list]);
    else
        writeList(FAVORITE_KEY, list);
}
function isFavorite(id) {
    return Boolean(id && readList(FAVORITE_KEY).some((record) => record.id === id));
}
function readFavorites() {
    return readList(FAVORITE_KEY);
}
function replaceFavorites(list) {
    writeList(FAVORITE_KEY, list);
}
