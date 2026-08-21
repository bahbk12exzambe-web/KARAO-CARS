const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

const db = new sqlite3.Database('./cars_database.sqlite', (err) => {
  if (!err) console.log('✅ تم الاتصال بقاعدة البيانات بنجاح.');
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.get(`SELECT * FROM admin_users WHERE id = 1`, (err, row) => {
    if (!row) {
      db.run(`INSERT INTO admin_users (email, password) VALUES ('admin@karao.com', 'admin123')`);
    }
  });

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
      car_image TEXT,
      status TEXT DEFAULT 'available',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`ALTER TABLE cars ADD COLUMN car_image TEXT`, (err) => {});
  db.run(`ALTER TABLE cars ADD COLUMN status TEXT DEFAULT 'available'`, (err) => {});

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

function requireAdminAuth(req, res, next) {
  const authHeader = req.headers['x-admin-token'];
  if (!authHeader) {
    return res.status(403).json({ error: 'غير مصرح لك! يرجى تسجيل الدخول.' });
  }

  db.get(`SELECT * FROM admin_users WHERE email = ?`, [authHeader], (err, user) => {
    if (err || !user) {
      return res.status(403).json({ error: 'جلسة الدخول غير صالحة.' });
    }
    req.admin = user;
    next();
  });
}

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  db.get(`SELECT * FROM admin_users WHERE LOWER(email) = LOWER(?) AND password = ?`, [email.trim(), password.trim()], (err, user) => {
    if (err || !user) {
      return res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة!' });
    }
    res.json({ success: true, email: user.email });
  });
});

app.put('/api/auth/update-account', requireAdminAuth, (req, res) => {
  const { newEmail, oldPassword, newPassword } = req.body;
  if (oldPassword !== req.admin.password) {
    return res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة!' });
  }

  const updatedEmail = newEmail ? newEmail.trim().toLowerCase() : req.admin.email;
  const updatedPass = newPassword ? newPassword.trim() : oldPassword;

  db.run(
    `UPDATE admin_users SET email = ?, password = ? WHERE id = ?`,
    [updatedEmail, updatedPass, req.admin.id],
    function(err) {
      if (err) return res.status(500).json({ error: 'فشل في التحديث' });
      res.json({ success: true, newEmail: updatedEmail });
    }
  );
});

app.get('/api/cars', (req, res) => {
  const { search, status } = req.query;
  let query = `SELECT * FROM cars WHERE 1=1`;
  let params = [];

  if (status && status !== 'all') {
    query += ` AND status = ?`;
    params.push(status);
  }

  if (search) {
    query += ` AND (plate_number LIKE ? OR car_name LIKE ? OR car_model LIKE ? OR chassis_number LIKE ? OR car_notes LIKE ?)`;
    const s = `%${search}%`;
    params.push(s, s, s, s, s);
  }

  query += ` ORDER BY id DESC`;

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: 'فشل في جلب البيانات' });
    res.json({ cars: rows });
  });
});

app.post('/api/cars', requireAdminAuth, (req, res) => {
  const { plate_number, car_name, car_model, car_year, chassis_number, car_color, car_price, car_date, car_notes, car_image, status } = req.body;
  const query = `
    INSERT INTO cars (plate_number, car_name, car_model, car_year, chassis_number, car_color, car_price, car_date, car_notes, car_image, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  db.run(query, [plate_number, car_name, car_model, car_year, chassis_number, car_color, car_price || 0, car_date, car_notes, car_image || null, status || 'available'], function(err) {
    if (err) return res.status(500).json({ error: 'فشل في الحفظ' });
    res.json({ message: 'تم الحفظ بنجاح', id: this.lastID });
  });
});

app.put('/api/cars/:id', requireAdminAuth, (req, res) => {
  const { id } = req.params;
  const { plate_number, car_name, car_model, car_year, chassis_number, car_color, car_price, car_date, car_notes, car_image, status } = req.body;
  const query = `
    UPDATE cars 
    SET plate_number = ?, car_name = ?, car_model = ?, car_year = ?, chassis_number = ?, car_color = ?, car_price = ?, car_date = ?, car_notes = ?, car_image = COALESCE(?, car_image), status = ?
    WHERE id = ?
  `;
  db.run(query, [plate_number, car_name, car_model, car_year, chassis_number, car_color, car_price, car_date, car_notes, car_image, status || 'available', id], function(err) {
    if (err) return res.status(500).json({ error: 'فشل في التعديل' });
    res.json({ message: 'تم التحديث بنجاح' });
  });
});

app.delete('/api/cars/:id', requireAdminAuth, (req, res) => {
  const { id } = req.params;
  db.run(`DELETE FROM cars WHERE id = ?`, [id], function(err) {
    if (err) return res.status(500).json({ error: 'فشل في الحذف' });
    res.json({ message: 'تم الحذف بنجاح' });
  });
});

app.post('/api/invoices', requireAdminAuth, (req, res) => {
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
      SUM(CASE WHEN status = 'reserved' THEN 1 ELSE 0 END) as reserved_cars,
      SUM(car_price) as total_value
    FROM cars
  `, [], (err, row) => {
    if (err) return res.status(500).json({ error: 'فشل في الإحصائيات' });
    res.json({ stats: row });
  });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => {
  console.log(`🚀 السيرفر يعمل على المنفذ: ${PORT}`);
});
