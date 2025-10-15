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

// PASTE THIS NEW ENDPOINT HERE
app.get('/api/students/:studentId', async (req, res) => {
  const { studentId } = req.params;

  try {
    const query = 'SELECT student_id, first_name, last_name, email, admission_date, department, current_year, status FROM "student" WHERE student_id = $1';
    const result = await pool.query(query, [studentId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Student not found.' });
    }
    
    res.status(200).json(result.rows[0]);

  } catch (error) {
    console.error('Database error fetching student:', error);
    res.status(500).json({ message: 'An internal server error occurred.' });
  }
});

// 6. Start the server
app.listen(PORT, () => {
  console.log(`✅ Backend server is running on http://localhost:${PORT}`);
});