"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureOpenid = ensureOpenid;
const api_1 = require("./api");
async function ensureOpenid() {
    const cached = String(wx.getStorageSync("openid") || "");
    if (cached)
        return cached;
    const code = await new Promise((resolve) => {
        wx.login({
            success: (result) => resolve(result.code || ""),
            fail: () => resolve(""),
        });
    });
    if (!code)
        throw new Error("微信登录失败");
    const result = await (0, api_1.post)("/auth/login", { code });
    if (!result.openid)
        throw new Error("微信登录失败");
    wx.setStorageSync("openid", result.openid);
    return result.openid;
}
