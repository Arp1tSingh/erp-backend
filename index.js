// backend/index.js
require('dotenv').config();
console.log('Attempting to connect with DATABASE_URL:', process.env.DATABASE_URL);

// 1. Import all necessary packages
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// 2. Initialize the Express app and set the port
const app = express();
const PORT = 3001;

// 3. Set up middleware
app.use(cors());
app.use(express.json());

// 4. Connect to your Supabase database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// 5. Create the Login API Endpoint
app.post('/api/login', async (req, res) => {
  const { userId, password, role } = req.body;

  if (!userId || !password || !role) {
    return res.status(400).json({ message: 'ID, password, and role are required.' });
  }

  try {
    let query;
    if (role === 'student') {
      query = 'SELECT * FROM "student" WHERE student_id = $1';
    } else if (role === 'admin') {
      query = 'SELECT * FROM "admin" WHERE email = $1';
    } else {
      return res.status(400).json({ message: 'Invalid role specified.' });
    }

    const result = await pool.query(query, [userId]);

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const user = result.rows[0];
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    delete user.password_hash;
    res.status(200).json({ message: 'Login successful!', user });

  } catch (error) {
    console.error('Database error during login:', error);
    res.status(500).json({ message: 'An internal server error occurred.' });
  }
});

// --- CORRECTED STUDENT DATA ENDPOINT ---
app.get('/api/students/:studentId', async (req, res) => {
  const { studentId } = req.params;
  console.log(`--- Request received for student ID: ${studentId} ---`);

  // Start of the main try block for this route
  try {
    // === Step 1: Get Student Profile Data ===
    const studentQuery = 'SELECT student_id, first_name, last_name, email, admission_date, department, current_year, status FROM "student" WHERE student_id = $1';
    const studentResult = await pool.query(studentQuery, [studentId]);

    if (studentResult.rows.length === 0) {
        console.log(`Student not found for ID: ${studentId}`);
        return res.status(404).json({ message: 'Student not found.' });
    }
    const studentData = studentResult.rows[0];

    // === Step 2: Calculate SGPA ===
    const sgpaQuery = `
      WITH LatestSemester AS (
          SELECT MAX(semester_id) as latest_sem_id
          FROM "enrollment"
          WHERE student_id = $1
      )
      SELECT
        COALESCE(SUM(c.credit_hours * g.gpa_point) / NULLIF(SUM(c.credit_hours), 0), 0) AS sgpa
      FROM "enrollment" e
      JOIN "grade" g ON e.enrollment_id = g.enrollment_id
      JOIN "course" c ON e.course_id = c.course_id
      JOIN LatestSemester ls ON e.semester_id = ls.latest_sem_id
      WHERE e.student_id = $1;
    `;
    const sgpaResult = await pool.query(sgpaQuery, [studentId]);
    const sgpa = parseFloat(sgpaResult.rows[0]?.sgpa || 0).toFixed(2);
    console.log(`Calculated SGPA for ${studentId}: ${sgpa}`);

    // === Step 3: Calculate Attendance Rate ===
    const attendanceQuery = `
      SELECT
        COUNT(CASE WHEN a.status IN ('Present', 'Late') THEN 1 ELSE NULL END) AS attended_classes,
        COUNT(a.attendance_id) AS total_classes
      FROM "attendance" a
      JOIN "enrollment" e ON a.enrollment_id = e.enrollment_id
      WHERE e.student_id = $1;
    `;
    const attendanceResult = await pool.query(attendanceQuery, [studentId]);
    const attendedClasses = parseInt(attendanceResult.rows[0]?.attended_classes || 0);
    const totalClasses = parseInt(attendanceResult.rows[0]?.total_classes || 0);
    const attendanceRate = totalClasses === 0 ? 0 : ((attendedClasses / totalClasses) * 100);
    const formattedAttendanceRate = attendanceRate.toFixed(1);
    console.log(`Calculated Attendance Rate for ${studentId}: ${formattedAttendanceRate}%`);

    // === Step 4: Count Enrolled Courses for Current Semester ===
    const enrolledCoursesQuery = `
      SELECT COUNT(enrollment_id) AS course_count
      FROM "enrollment"
      WHERE student_id = $1
      AND semester_id = (
        SELECT MAX(semester_id)
        FROM "enrollment"
        WHERE student_id = $1
      );
    `;
    const enrolledCoursesResult = await pool.query(enrolledCoursesQuery, [studentId]);
    const enrolledCoursesCount = parseInt(enrolledCoursesResult.rows[0]?.course_count || 0);
    console.log(`Enrolled courses count for ${studentId} (latest semester): ${enrolledCoursesCount}`);

    // === Step 5: Send ONE combined response ===
    res.status(200).json({
      student: studentData,
      sgpa: sgpa,
      attendanceRate: formattedAttendanceRate,
      enrolledCoursesCount: enrolledCoursesCount
    });

  // End of the main try block for this route
  } catch (error) {
    // This is the error handler FOR THIS ROUTE
    console.error(`Database error fetching data for student ${studentId}:`, error);
    res.status(500).json({ message: 'An internal server error occurred while fetching dashboard data.' });
  }
// End of the app.get(...) function
});

// --- THE EXTRA CATCH BLOCK WAS REMOVED FROM HERE ---

// 6. Start the server
app.listen(PORT, () => {
  console.log(`✅ Backend server is running on http://localhost:${PORT}`);
});