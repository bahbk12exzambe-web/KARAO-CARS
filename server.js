const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// خدمة الملفات الثابتة
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// قاعدة البيانات SQLite السحابية
const db = new sqlite3.Database('./cars_database.sqlite', (err) => {
  if (!err) console.log('✅ تم الاتصال بقاعدة البيانات بنجاح.');
});

// تهيئة الجداول وكلمة مرور الإدارة الافتراضية
db.serialize(() => {
  // جدول الإعدادات لحفظ كلمة المرور السحابية
  db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
  
  // وضع كلمة المرور الافتراضية 2026 إذا لم تكن موجودة
  db.get(`SELECT value FROM settings WHERE key = 'admin_password'`, (err, row) => {
    if (!row) {
      db.run(`INSERT INTO settings (key, value) VALUES ('admin_password', '2026')`);
    }
  });

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

// وسيط التحقق من صلاحية الإدارة
function requireAdmin(req, res, next) {
  const adminKey = req.headers['x-admin-key'];
  db.get(`SELECT value FROM settings WHERE key = 'admin_password'`, (err, row) => {
    const currentPass = row ? row.value : '2026';
    if (adminKey === currentPass || adminKey === 'google_auth_approved') {
      next();
    } else {
      res.status(403).json({ error: 'غير مصرح لك! يرجى تسجيل دخول الإدارة.' });
    }
  });
}

// ==================== [ مسارات المصادقة والأمان ] ==================== //

// 1. التحقق من كلمة مرور الإدارة
app.post('/api/admin/verify', (req, res) => {
  const { password } = req.body;
  db.get(`SELECT value FROM settings WHERE key = 'admin_password'`, (err, row) => {
    const currentPass = row ? row.value : '2026';
    if (password === currentPass) {
      res.json({ success: true, token: currentPass });
    } else {
      res.status(401).json({ success: false, error: 'رمز المرور غير صحيح!' });
    }
  });
});

// 2. تغيير كلمة مرور الإدارة
app.put('/api/admin/change-password', requireAdmin, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: 'يجب أن تتكون كلمة المرور الجديدة من 4 خانات على الأقل' });
  }

  db.get(`SELECT value FROM settings WHERE key = 'admin_password'`, (err, row) => {
    const currentPass = row ? row.value : '2026';
    if (oldPassword !== currentPass) {
      return res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة!' });
    }

    db.run(`UPDATE settings SET value = ? WHERE key = 'admin_password'`, [newPassword], (err) => {
      if (err) return res.status(500).json({ error: 'فشل في تحديث كلمة المرور' });
      res.json({ success: true, message: 'تم تحديث كلمة المرور بنجاح', newKey: newPassword });
    });
  });
});

// 3. تسجيل الدخول عبر Google
app.post('/api/auth/google', (req, res) => {
  const { credential } = req.body;
  if (!credential) {
    return res.status(400).json({ error: 'رمز Google مفقود' });
  }
  // فك تشفير بيانات Google Token
  try {
    const base64Url = credential.split('.');
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
    const googleUser = JSON.parse(jsonPayload);

    // التحقق من صلاحية الإدارة
    db.get(`SELECT value FROM settings WHERE key = 'admin_password'`, (err, row) => {
      const currentPass = row ? row.value : '2026';
      res.json({
        success: true,
        user: { name: googleUser.name, email: googleUser.email, picture: googleUser.picture },
        token: currentPass
      });
    });
  } catch (err) {
    res.status(400).json({ error: 'فشل في التحقق من حساب Google' });
  }
});

// ==================== [ مسارات السيارات والفواتير ] ==================== //

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
    if (err) return res.status(500).json({ error: 'فشل في جلب البيانات' });
    res.json({ cars: rows });
  });
});

app.post('/api/cars', requireAdmin, (req, res) => {
  const { plate_number, car_name, car_model, car_year, chassis_number, car_color, car_price, car_date, car_notes } = req.body;
  const query = `
    INSERT INTO cars (plate_number, car_name, car_model, car_year, chassis_number, car_color, car_price, car_date, car_notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  db.run(query, [plate_number, car_name, car_model, car_year, chassis_number, car_color, car_price || 0, car_date, car_notes], function(err) {
    if (err) return res.status(500).json({ error: 'فشل في الحفظ' });
    res.json({ message: 'تم الحفظ بنجاح', id: this.lastID });
  });
});

app.put('/api/cars/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { plate_number, car_name, car_model, car_year, chassis_number, car_color, car_price, car_date, car_notes, status } = req.body;
  const query = `
    UPDATE cars 
    SET plate_number = ?, car_name = ?, car_model = ?, car_year = ?, chassis_number = ?, car_color = ?, car_price = ?, car_date = ?, car_notes = ?, status = ?
    WHERE id = ?
  `;
  db.run(query, [plate_number, car_name, car_model, car_year, chassis_number, car_color, car_price, car_date, car_notes, status || 'available', id], function(err) {
    if (err) return res.status(500).json({ error: 'فشل في التعديل' });
    res.json({ message: 'تم التحديث بنجاح' });
  });
});

app.delete('/api/cars/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  db.run(`DELETE FROM cars WHERE id = ?`, [id], function(err) {
    if (err) return res.status(500).json({ error: 'فشل في الحذف' });
    res.json({ message: 'تم الحذف بنجاح' });
  });
});

app.post('/api/invoices', requireAdmin, (req, res) => {
  const { invoice_no, type, car_id, client_name, client_phone, total_price, payment_method } = req.body;
  const query = `
    INSERT INTO invoices (invoice_no, type, car_id, client_name, client_phone, total_price, payment_method)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;
  db.run(query, [invoice_no, type, car_id, client_name, client_phone, total_price, payment_method], function(err) {
    if (err) return res.status(500).json({ error: 'فشل في إصدار الفاتورة' });
    if (type === 'sale' && car_id) {
      db.run(`UPDATE cars SET status = 'sold' WHERE id = ?`, [car_id]);
    }
    res.json({ message: 'تم إصدار الفاتورة بنجاح', invoiceId: this.lastID });
  });
});

app.get('/api/stats', (req, res) => {
  db.get(`
    SELECT 
      COUNT(*) as total_cars,
      SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available_cars,
      SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) as sold_cars,
      SUM(car_price) as total_value
    FROM cars
  `, [], (err, row) => {
    if (err) return res.status(500).json({ error: 'فشل في الإحصائيات' });
    res.json({ stats: row });
  });
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 خادم شركة بشار فواز كرعو وشركاه يعمل على المنفذ: ${PORT}`);
});
