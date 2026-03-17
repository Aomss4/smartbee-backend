require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const axios = require("axios");
const cors = require("cors");

const Record = require("./models/Record");

const app = express();
app.use(cors());
app.use(express.json());

const CHINA_API_URL = "https://apict.zhinenggui.cc/plat/cutterApi/searchAllBorrowTime";

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ Connected to MongoDB Atlas!");
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("❌ MongoDB Connection Error:", err.message);
  });

// --- 2. [POST] Route สำหรับ Sync ข้อมูล ---
app.post('/api/sync-records', async (req, res) => {
  const { token, startDate, endDate, machineId } = req.body;

  try {
    console.log(`⏳ Starting Sync for ${machineId}: ${startDate} to ${endDate}`);
    
    const firstRes = await axios.post(CHINA_API_URL, null, {
      params: { 
        token: token, 
        star_str: `${startDate} 00:00:00`, 
        end_str: `${endDate} 23:59:59`, 
        page: 1 
      }
    });

    if (firstRes.data.status !== 1) {
      return res.status(400).json({ error: "API จีนตอบกลับผิดพลาด: " + firstRes.data.message });
    }

    const totalPages = firstRes.data.data.pageCount || 1;
    let allRows = [...firstRes.data.data.rows];

    if (totalPages > 1) {
      const promises = [];
      for (let i = 2; i <= totalPages; i++) {
        promises.push(axios.post(CHINA_API_URL, null, {
          params: { 
            token: token, 
            star_str: `${startDate} 00:00:00`, 
            end_str: `${endDate} 23:59:59`, 
            page: i 
          }
        }));
      }
      const results = await Promise.all(promises);
      results.forEach(r => {
        if (r.data.status === 1) allRows = [...allRows, ...r.data.data.rows];
      });
    }

    // เตรียมข้อมูลลง MongoDB
    const operations = allRows.map(row => {
      // 1. รับเวลาจากจีนมา (ระบุว่าเป็น +08:00)
      const chinaTime = new Date(row.pay_time.replace(' ', 'T') + "+08:00");

      // 2. 🔥 ลดลง 1 ชั่วโมงเพื่อให้เป็นเวลาไทย (3,600,000 มิลลิวินาที)
      const thaiTime = new Date(chinaTime.getTime() - (60 * 60 * 1000));

      return {
        updateOne: {
          filter: { record_id: row.id },
          update: { 
            $set: { 
              pay_time: thaiTime, 
              product_name: row.product_name,
              user_name: row.user_name,
              pay_num: row.pay_num,
              price: row.price,
              machine_id: machineId
            }
          },
          upsert: true
        }
      };
    });

    if (operations.length > 0) {
      await Record.bulkWrite(operations);
    }

    console.log(`✨ Sync Completed: ${allRows.length} records saved.`);
    res.json({ message: "Sync Success!", total: allRows.length });

  } catch (error) {
    console.error("Sync Error:", error.message);
    res.status(500).json({ error: 'Sync Error: ' + error.message });
  }
});

// --- 3. [GET] Route สำหรับดึงข้อมูลจาก MongoDB ---
app.get('/api/records', async (req, res) => {
  const { machineId, startDate, endDate } = req.query;
  
  try {
    // ใช้ Timezone ไทยในการค้นหา
    const start = new Date(startDate + "T00:00:00+07:00");
    const end = new Date(endDate + "T23:59:59+07:00");

    const records = await Record.find({
      machine_id: machineId,
      pay_time: { $gte: start, $lte: end }
    }).sort({ pay_time: -1 });
    
    res.json(records);
  } catch (error) {
    console.error("Fetch Error:", error.message);
    res.status(500).json({ error: 'Fetch Error: ' + error.message });
  }
});

module.exports = app;