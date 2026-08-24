module.exports = {
  // 通过 GitHub Actions 触发部署并 PM2 --update-env 重启，加载最新 .env。
  apps: [
    {
      name: "wallpaper-api",
      cwd: __dirname,
      script: "apps/api/dist/main.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: "4000"
      }
    }
  ]
};
