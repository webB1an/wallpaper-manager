"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logDownload = logDownload;
exports.logDownloadError = logDownloadError;
// 下载链路排查日志：优先写微信实时日志（真机可在 小程序助手/MP后台 查看），同时打到 console。
const realtime = wx.getRealtimeLogManager ? wx.getRealtimeLogManager() : null;
function logDownload(step, detail) {
    if (realtime) {
        realtime.info("[download]", step, detail ?? "");
    }
    console.log("[download]", step, detail);
}
function logDownloadError(step, error) {
    const message = error instanceof Error ? error.message : String(error);
    if (realtime) {
        realtime.error("[download]", step, message);
    }
    console.error("[download]", step, error);
}
