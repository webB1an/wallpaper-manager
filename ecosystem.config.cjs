module.exports = {
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
