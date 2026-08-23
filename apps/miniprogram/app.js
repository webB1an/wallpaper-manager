"use strict";
App({
    onLaunch() {
        wx.showShareMenu({
            withShareTicket: false,
            menus: ["shareAppMessage", "shareTimeline"]
        });
    },
    globalData: {
        apiBase: "https://wall-api.wdbzk.com/api"
    }
});
