"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.API_BASE = void 0;
exports.request = request;
exports.post = post;
exports.API_BASE = "https://wall-api.wdbzk.com/api";
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
    const useBody = method === "POST" && data && Object.keys(data).length > 0;
    return new Promise((resolve, reject) => {
        const openid = wx.getStorageSync("openid") || "";
        wx.request({
            url: `${exports.API_BASE}${path}${useBody ? "" : query}`,
            method,
            timeout: 12000,
            header: {
                ...(openid ? { "X-Openid": openid } : {}),
                ...(useBody ? { "Content-Type": "application/json" } : {}),
            },
            data: useBody ? JSON.stringify(data) : undefined,
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
