const mongoose = require('mongoose');

const recordSchema = new mongoose.Schema({
  record_id: { type: String, unique: true },
  pay_time: Date,
  product_name: String,
  user_name: String,
  pay_num: Number,
  price: Number,
  machine_id: String
}, { timestamps: true });

module.exports = mongoose.model('Record', recordSchema);