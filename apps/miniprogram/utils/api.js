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
                reject(new Error(error.errMsg));
            }
        });
    });
}
