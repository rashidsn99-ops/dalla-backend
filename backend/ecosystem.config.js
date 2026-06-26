// ecosystem.config.js — PM2 Cluster Mode لاستغلال كل CPU cores
// تشغيل: pm2 start ecosystem.config.js
// على Render: startCommand = "pm2-runtime start ecosystem.config.js"

module.exports = {
  apps: [
    {
      name: "dalla-backend",
      script: "server.js",
      
      // Cluster mode: يشغّل نسخة لكل CPU core تلقائياً
      instances: "max",   // أو رقم ثابت مثل 2 أو 4
      exec_mode: "cluster",

      // بيئة الإنتاج
      node_args: "--max-old-space-size=512", // حد ذاكرة كل نسخة
      env_production: {
        NODE_ENV: "production",
        PORT: 4000,
      },

      // إعادة التشغيل التلقائي عند الأعطال
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",  // أعد التشغيل لو تجاوز 512MB RAM
      restart_delay: 2000,          // انتظر 2 ثانية قبل إعادة التشغيل

      // Graceful shutdown (لا تقطع الاتصالات الجارية)
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,

      // Logging
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
