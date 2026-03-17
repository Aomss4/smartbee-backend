require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const axios = require("axios");
const cors = require("cors");

// นำเข้า Model
const Record = require("./models/Record");

const app = express();
app.use(cors());
app.use(express.json());

const CHINA_API_URL = "https://apict.zhinenggui.cc/plat/cutterApi/searchAllBorrowTime";

// --- 1. ส่วนเชื่อมต่อ MongoDB และเริ่มรัน Server ---
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
    
    // 🔥 แก้ไข Key ให้ตรงกับ Postman: star_str และ end_str
    const firstRes = await axios.post(CHINA_API_URL, null, {
      params: { 
        token: token, 
        star_str: `${startDate} 00:00:00`, 
        end_str: `${endDate} 23:59:59`, 
        page: 1 
      }
    });

    // ดูผลลัพธ์จากจีนใน Terminal ของเรา
    console.log("Response from China (Page 1):", firstRes.data);

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
    const operations = allRows.map(row => ({
      updateOne: {
        filter: { record_id: row.id }, // ใช้ id จากจีนป้องกันข้อมูลซ้ำ
        update: { 
          $set: { 
            pay_time: new Date(row.pay_time),
            product_name: row.product_name,
            user_name: row.user_name,
            pay_num: row.pay_num,
            price: row.price,
            machine_id: machineId
          }
        },
        upsert: true
      }
    }));

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
    const records = await Record.find({
      machine_id: machineId,
      pay_time: {
        $gte: new Date(startDate + " 00:00:00"),
        $lte: new Date(endDate + " 23:59:59")
      }
    }).sort({ pay_time: -1 });
    
    res.json(records);
  } catch (error) {
    console.error("Fetch Error:", error.message);
    res.status(500).json({ error: 'Fetch Error: ' + error.message });
  }
});