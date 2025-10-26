// backend/index.js
require('dotenv').config(); // This loads the variables from your .env file
console.log('Attempting to connect with DATABASE_URL:', process.env.DATABASE_URL);  
// 1. Import all necessary packages
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// 2. Initialize the Express app and set the port
const app = express();
const PORT = 3001; // Your backend will run on this port

// 3. Set up middleware
app.use(cors()); // This enables CORS for all routes, fixing the browser security issue
app.use(express.json()); // This allows our server to understand JSON data sent from the frontend

// 4. Connect to your Supabase database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// 5. Create the Login API Endpoint
app.post('/api/login', async (req, res) => {
  // Get the data sent from the React form
  const { userId, password, role } = req.body;

  // Basic validation
  if (!userId || !password || !role) {
    return res.status(400).json({ message: 'ID, password, and role are required.' });
  }

  try {
    let query;
    // Determine which table to search based on the role
    if (role === 'student') {
      query = 'SELECT * FROM "student" WHERE student_id = $1';
    } else if (role === 'admin') {
      query = 'SELECT * FROM "admin" WHERE email = $1'; 
    } else {
      return res.status(400).json({ message: 'Invalid role specified.' });
    }

    // Execute the query safely using parameters to prevent SQL injection
    const result = await pool.query(query, [userId]);

    // Check if a user was found
    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials.' }); // Use a generic message for security
    }

    const user = result.rows[0];

    // Compare the submitted password with the hashed password in the database
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    // If login is successful, send back a success message and user data (without the password!)
    // IMPORTANT: Never send the password hash back to the frontend.
    delete user.password_hash; 
    res.status(200).json({ message: 'Login successful!', user });

  } catch (error) {
    console.error('Database error during login:', error);
    res.status(500).json({ message: 'An internal server error occurred.' });
  }
});


app.get('/api/students/:studentId', async (req, res) => {
  // Log receipt of request (good for debugging)
  console.log(`--- Request received for student ID: ${req.params.studentId} ---`);
  const { studentId } = req.params;

  try {
    // === Step 1: Get Student Profile Data ===
    const studentQuery = 'SELECT student_id, first_name, last_name, email, admission_date, department, current_year, status FROM "student" WHERE student_id = $1';
    const studentResult = await pool.query(studentQuery, [studentId]);

    // Check if student exists
    if (studentResult.rows.length === 0) {
      console.log(`Student not found for ID: ${studentId}`); // Add log for debugging
      return res.status(404).json({ message: 'Student not found.' });
    }
    // Store the student data temporarily
    const studentData = studentResult.rows[0];

    // === Step 2: Calculate SGPA for the most recent semester ===
    const sgpaQuery = `
      WITH LatestSemester AS (
          SELECT MAX(semester_id) as latest_sem_id
          FROM "enrollment"
          WHERE student_id = $1
      )
      SELECT
        -- Calculate SUM(Credit * Point) / SUM(Credit)
        COALESCE(SUM(c.credit_hours * g.gpa_point) / NULLIF(SUM(c.credit_hours), 0), 0) AS sgpa
      FROM "enrollment" e
      JOIN "grade" g ON e.enrollment_id = g.enrollment_id
      JOIN "course" c ON e.course_id = c.course_id
      JOIN LatestSemester ls ON e.semester_id = ls.latest_sem_id -- Join with the subquery
      WHERE e.student_id = $1;
    `;
    const sgpaResult = await pool.query(sgpaQuery, [studentId]);

    // Extract SGPA, format to 2 decimal places, default to '0.00' if null/undefined
    const sgpa = parseFloat(sgpaResult.rows[0]?.sgpa || 0).toFixed(2);
    console.log(`Calculated SGPA for ${studentId}: ${sgpa}`); // Add log for debugging

    // === Step 3: Send ONE combined response ===
    // Send both the student profile data and the calculated SGPA
    res.status(200).json({ student: studentData, sgpa: sgpa });

  } catch (error) {
    // Log the detailed error on the server
    console.error(`Database error fetching data for student ${studentId}:`, error);
    // Send a generic error message to the client
    res.status(500).json({ message: 'An internal server error occurred while fetching dashboard data.' });
  }
});

// 6. Start the server
app.listen(PORT, () => {
  console.log(`✅ Backend server is running on http://localhost:${PORT}`);
});