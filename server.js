const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// الاتصال بقاعدة البيانات السحابية SQLite
const db = new sqlite3.Database('./cars_database.sqlite', (err) => {
  if (err) {
    console.error('❌ خطأ في الاتصال بقاعدة البيانات:', err);
  } else {
    console.log('✅ تم الاتصال بقاعدة البيانات السحابية بنجاح.');
  }
});

// إنشاء جداول النظام (السيارات، الفواتير، الإحصائيات)
db.serialize(() => {
  // جدول السيارات
  db.run(`
    CREATE TABLE IF NOT EXISTS cars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plate_number TEXT NOT NULL,
      car_name TEXT NOT NULL,
      car_model TEXT NOT NULL,
      car_year INTEGER NOT NULL,
      chassis_number TEXT NOT NULL,
      car_color TEXT,
      car_price REAL DEFAULT 0,
      car_date TEXT,
      car_notes TEXT,
      status TEXT DEFAULT 'available',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // جدول الفواتير
  db.run(`
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_no TEXT UNIQUE,
      type TEXT NOT NULL,
      car_id INTEGER,
      client_name TEXT NOT NULL,
      client_phone TEXT,
      total_price REAL NOT NULL,
      payment_method TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(car_id) REFERENCES cars(id)
    )
  `);
});

// ==================== [ مسارات الـ API ] ==================== //

// 1. جلب قائمة جميع السيارات مع البحث والفلترة
app.get('/api/cars', (req, res) => {
  const { search } = req.query;
  let query = `SELECT * FROM cars ORDER BY id DESC`;
  let params = [];

  if (search) {
    query = `
      SELECT * FROM cars 
      WHERE plate_number LIKE ? 
         OR car_name LIKE ? 
         OR car_model LIKE ? 
         OR chassis_number LIKE ? 
         OR car_notes LIKE ?
      ORDER BY id DESC
    `;
    const s = `%${search}%`;
    params = [s, s, s, s, s];
  }

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: 'فشل في جلب السيارات' });
    res.json({ cars: rows });
  });
});

// 2. إضافة سيارة جديدة
app.post('/api/cars', (req, res) => {
  const { plate_number, car_name, car_model, car_year, chassis_number, car_color, car_price, car_date, car_notes } = req.body;

  if (!plate_number || !car_name || !car_model || !chassis_number) {
    return res.status(400).json({ error: 'يرجى ملء الحقول الإجبارية' });
  }

  const query = `
    INSERT INTO cars (plate_number, car_name, car_model, car_year, chassis_number, car_color, car_price, car_date, car_notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.run(query, [plate_number, car_name, car_model, car_year, chassis_number, car_color, car_price || 0, car_date, car_notes], function(err) {
    if (err) return res.status(500).json({ error: 'فشل في إضافة السيارة' });
    res.json({ message: 'تم حفظ السيارة بنجاح', id: this.lastID });
  });
});

// 3. تعديل بيانات سيارة
app.put('/api/cars/:id', (req, res) => {
  const { id } = req.params;
  const { plate_number, car_name, car_model, car_year, chassis_number, car_color, car_price, car_date, car_notes, status } = req.body;

  const query = `
    UPDATE cars 
    SET plate_number = ?, car_name = ?, car_model = ?, car_year = ?, chassis_number = ?, car_color = ?, car_price = ?, car_date = ?, car_notes = ?, status = ?
    WHERE id = ?
  `;

  db.run(query, [plate_number, car_name, car_model, car_year, chassis_number, car_color, car_price, car_date, car_notes, status || 'available', id], function(err) {
    if (err) return res.status(500).json({ error: 'فشل في تعديل البيانات' });
    res.json({ message: 'تم تحديث بيانات السيارة بنجاح' });
  });
});

// 4. حذف سيارة
app.delete('/api/cars/:id', (req, res) => {
  const { id } = req.params;
  db.run(`DELETE FROM cars WHERE id = ?`, [id], function(err) {
    if (err) return res.status(500).json({ error: 'فشل في حذف السيارة' });
    res.json({ message: 'تم الحذف بنجاح' });
  });
});

// 5. حفظ فاتورة بيع أو شراء وتحديث حالة السيارة
app.post('/api/invoices', (req, res) => {
  const { invoice_no, type, car_id, client_name, client_phone, total_price, payment_method } = req.body;

  const query = `
    INSERT INTO invoices (invoice_no, type, car_id, client_name, client_phone, total_price, payment_method)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  db.run(query, [invoice_no, type, car_id, client_name, client_phone, total_price, payment_method], function(err) {
    if (err) return res.status(500).json({ error: 'فشل في حفظ الفاتورة' });

    // تحديث حالة السيارة إذا كانت فاتورة بيع إلى 'sold'
    if (type === 'sale' && car_id) {
      db.run(`UPDATE cars SET status = 'sold' WHERE id = ?`, [car_id]);
    }

    res.json({ message: 'تم إصدار الفاتورة بنجاح', invoiceId: this.lastID });
  });
});

// 6. إحصائيات لوحة التحكم
app.get('/api/stats', (req, res) => {
  db.get(`
    SELECT 
      COUNT(*) as total_cars,
      SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available_cars,
      SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) as sold_cars,
      SUM(car_price) as total_value
    FROM cars
  `, [], (err, row) => {
    if (err) return res.status(500).json({ error: 'فشل في جلب الإحصائيات' });
    res.json({ stats: row });
  });
});

// تشغيل السيرفر
app.listen(PORT, () => {
  console.log(`🚀 خادم شركة بشار فواز كرعو وشركاه يعمل أونلاين على المنفذ: http://localhost:${PORT}`);
});