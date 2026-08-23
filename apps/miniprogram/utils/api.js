"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.request = request;
exports.post = post;
const API_BASE = "https://wall-api.wdbzk.com/api";
function request(path, data) {
    return requestWithMethod("GET", path, data);
}
function post(path, data) {
    return requestWithMethod("POST", path, data);
}
function requestWithMethod(method, path, data) {
    const query = data
        ? "?" + Object.entries(data)
            .filter(([, value]) => value !== undefined && value !== "")
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
            .join("&")
        : "";
    return new Promise((resolve, reject) => {
        wx.request({
            url: `${API_BASE}${path}${query}`,
            method,
            timeout: 12000,
            success(response) {
                const body = response.data;
                if (response.statusCode >= 200 && response.statusCode < 300 && body.code === 200) {
                    resolve(body.data);
                }
                else {
                    reject(new Error(body.message || "请求失败"));
                }
            },
            fail(error) {
                reject(new Error(formatRequestFailure(error.errMsg)));
            }
        });
    });
}
function formatRequestFailure(message = "") {
    if (message.includes("url not in domain list") || message.includes("domain list")) {
        return "请求被微信域名拦截，请在小程序后台加入 wall-api.wdbzk.com";
    }
    if (message.includes("timeout"))
        return "网络超时，请稍后重试";
    return message || "网络请求失败";
}
