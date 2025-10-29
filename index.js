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

app.get('/api/students', async (req, res) => {
  console.log('--- Request received to GET all students ---');
  try {
    // Select relevant columns, excluding password hash
    const query = `
      SELECT 
        student_id, first_name, last_name, email, admission_date, 
        department, current_year, status 
      FROM "student" 
      ORDER BY student_id; 
    `;
    const result = await pool.query(query);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Database error fetching all students:', error);
    res.status(500).json({ message: 'An internal server error occurred while fetching students.' });
  }
});

app.get('/api/stats/average-gpa', async (req, res) => {
  console.log(`--- Request received for Overall Average GPA ---`);
  try {
    const query = `
      SELECT COALESCE(AVG(gpa_point), 0) AS average_gpa 
      FROM "grade";
    `;
    const result = await pool.query(query);
    const averageGpa = parseFloat(result.rows[0]?.average_gpa || 0).toFixed(2); // Format to 2 decimal places

    console.log(`Calculated Overall Average GPA: ${averageGpa}`);
    res.status(200).json({ averageSgpa: averageGpa }); // Send back using the key 'averageSgpa'

  } catch (error) {
    console.error('Database error calculating average GPA:', error);
    res.status(500).json({ message: 'An internal server error occurred while calculating average GPA.' });
  }
});

// --- STUDENT DASHBOARD DATA ENDPOINT ---
app.get('/api/students/:studentId', async (req, res) => {
  const { studentId } = req.params;
  console.log(`--- Request received for student ID: ${studentId} ---`);
  

  try {
    // === Step 1: Get Student Profile Data ===
    const studentQuery = 'SELECT student_id, first_name, last_name, email, admission_date, department, current_year, status FROM "student" WHERE student_id = $1';
    const studentResult = await pool.query(studentQuery, [studentId]);

    if (studentResult.rows.length === 0) {
        console.log(`Student not found for ID: ${studentId}`);
        return res.status(404).json({ message: 'Student not found.' });
    }
    const studentData = studentResult.rows[0];

    // === Step 1.5: Find the student's latest semester ID ONCE ===
    const latestSemesterQuery = `SELECT MAX(semester_id) as latest_sem_id FROM "enrollment" WHERE student_id = $1;`;
    const semesterResult = await pool.query(latestSemesterQuery, [studentId]);
    const latestSemesterId = semesterResult.rows[0]?.latest_sem_id; // Store it here

    // --- Initialize variables with default values ---
    let sgpa = '0.00';
    let formattedAttendanceRate = '0.0';
    let enrolledCoursesCount = 0;

    // Only proceed with calculations if the student has enrollments
    if (latestSemesterId) {
        console.log(`Latest semester ID for ${studentId} is ${latestSemesterId}`);

        // === Step 2: Calculate SGPA (Use the latestSemesterId found above) ===
        const sgpaQuery = `
          SELECT COALESCE(SUM(c.credit_hours * g.gpa_point) / NULLIF(SUM(c.credit_hours), 0), 0) AS sgpa
          FROM "enrollment" e
          JOIN "grade" g ON e.enrollment_id = g.enrollment_id
          JOIN "course" c ON e.course_id = c.course_id
          WHERE e.student_id = $1 AND e.semester_id = $2; -- Use $2 for latestSemesterId
        `;
        // Pass both parameters here
        const sgpaResult = await pool.query(sgpaQuery, [studentId, latestSemesterId]);
        sgpa = parseFloat(sgpaResult.rows[0]?.sgpa || 0).toFixed(2);
        console.log(`Calculated SGPA for ${studentId}: ${sgpa}`);

        // === Step 3: Calculate Attendance Rate (Use the latestSemesterId found above) ===
        const attendanceQuery = `
          SELECT
            COUNT(CASE WHEN a.status IN ('Present', 'Late') THEN 1 ELSE NULL END) AS attended_classes,
            COUNT(a.attendance_id) AS total_classes
          FROM "attendance" a
          JOIN "enrollment" e ON a.enrollment_id = e.enrollment_id
          WHERE e.student_id = $1 AND e.semester_id = $2; -- Use $2 for latestSemesterId
        `;
        // Pass both parameters here
        const attendanceResult = await pool.query(attendanceQuery, [studentId, latestSemesterId]);
        const attendedClasses = parseInt(attendanceResult.rows[0]?.attended_classes || 0);
        const totalClasses = parseInt(attendanceResult.rows[0]?.total_classes || 0);
        const attendanceRate = totalClasses === 0 ? 0 : ((attendedClasses / totalClasses) * 100);
        formattedAttendanceRate = attendanceRate.toFixed(1);
        console.log(`Calculated Attendance Rate for ${studentId} (latest semester): ${formattedAttendanceRate}%`);

        // === Step 4: Count Enrolled Courses (Use the latestSemesterId found above) ===
        const enrolledCoursesQuery = `
          SELECT COUNT(enrollment_id) AS course_count
          FROM "enrollment"
          WHERE student_id = $1 AND semester_id = $2; -- Use $2 for latestSemesterId
        `;
        // Pass both parameters here
        const enrolledCoursesResult = await pool.query(enrolledCoursesQuery, [studentId, latestSemesterId]);
        enrolledCoursesCount = parseInt(enrolledCoursesResult.rows[0]?.course_count || 0);
        console.log(`Enrolled courses count for ${studentId} (latest semester): ${enrolledCoursesCount}`);

    } else {
        console.log(`No enrollments found for student ${studentId}. Returning default stats.`);
    }

    // === Step 5: Send ONE combined response ===
    res.status(200).json({
      student: studentData,
      sgpa: sgpa,
      attendanceRate: formattedAttendanceRate,
      enrolledCoursesCount: enrolledCoursesCount
    });

  } catch (error) {
    console.error(`Database error fetching data for student ${studentId}:`, error);
    res.status(500).json({ message: 'An internal server error occurred while fetching dashboard data.' });
  }
});

// --- CURRENT GRADES ENDPOINT ---
app.get('/api/grades/:studentId/current', async (req, res) => {
  const { studentId } = req.params;
  console.log(`--- Request received for CURRENT grades for student ${studentId} ---`);

  if (!studentId) {
    return res.status(400).json({ message: 'Student ID is required.' });
  }

  try {
    // === Step 1: Find the student's latest semester ID ===
    const latestSemesterQuery = `
      SELECT MAX(semester_id) as latest_sem_id
      FROM "enrollment"
      WHERE student_id = $1;
    `;
    const semesterResult = await pool.query(latestSemesterQuery, [studentId]);
    const latestSemesterId = semesterResult.rows[0]?.latest_sem_id;

    if (!latestSemesterId) {
      console.log(`No enrollments found for student ${studentId}`);
      return res.status(200).json({
        summary: { currentSgpa: '0.00', totalCredits: 0, coursesPassed: 0, totalCourses: 0, averageScore: '0.0' },
        details: []
      });
    }
    console.log(`Latest semester ID for ${studentId} is ${latestSemesterId}`);

    // === Step 2: Query for Detailed Course Grades for THAT semester ===
    const gradesQuery = `
      SELECT
        c.course_id, c.course_name, c.credit_hours,
        g.numeric_score, g.letter_grade, g.gpa_point
      FROM "enrollment" e
      JOIN "course" c ON e.course_id = c.course_id
      LEFT JOIN "grade" g ON e.enrollment_id = g.enrollment_id
      WHERE e.student_id = $1 AND e.semester_id = $2
      ORDER BY c.course_id;
    `;
    const gradesResult = await pool.query(gradesQuery, [studentId, latestSemesterId]);
    const courseGrades = gradesResult.rows;

    // === Step 3: Calculate Summary Statistics ===
    let totalCreditsAttempted = 0, totalPointsEarned = 0, totalScoreSum = 0;
    let gradedCoursesCount = 0, coursesPassed = 0;

    courseGrades.forEach(grade => {
      totalCreditsAttempted += grade.credit_hours;
      if (grade.gpa_point !== null && grade.numeric_score !== null) {
        gradedCoursesCount++;
        totalPointsEarned += grade.credit_hours * grade.gpa_point;
        totalScoreSum += parseFloat(grade.numeric_score);
        if (grade.gpa_point > 0) coursesPassed++;
      }
    });

    const creditsForGpaCalc = courseGrades.filter(g => g.gpa_point !== null).reduce((sum, g) => sum + g.credit_hours, 0);
    const currentSgpa = creditsForGpaCalc === 0 ? 0 : (totalPointsEarned / creditsForGpaCalc);
    const averageScore = gradedCoursesCount === 0 ? 0 : (totalScoreSum / gradedCoursesCount);

    console.log(`Calculated summary for ${studentId}, sem ${latestSemesterId}: SGPA=${currentSgpa.toFixed(2)}, Credits=${totalCreditsAttempted}, Passed=${coursesPassed}/${courseGrades.length}, AvgScore=${averageScore.toFixed(1)}`);

    // === Step 4: Send the Combined Data ===
    res.status(200).json({
      summary: {
        currentSgpa: currentSgpa.toFixed(2), totalCredits: totalCreditsAttempted,
        coursesPassed: coursesPassed, totalCourses: courseGrades.length,
        averageScore: averageScore.toFixed(1)
      },
      details: courseGrades
    });

  } catch (error) {
    console.error(`Database error fetching current grades for student ${studentId}:`, error);
    res.status(500).json({ message: 'An internal server error occurred while fetching grades.' });
  }
});

app.post('/api/students', async (req, res) => {
  // Extract data from request body (ensure frontend sends all required fields)
  const { student_id, first_name, last_name, email, password, admission_date, department, current_year, status } = req.body;
  console.log(`--- Request received to ADD student: ${student_id} ---`);

  // Basic validation (add more as needed)
  if (!student_id || !first_name || !last_name || !email || !password || !department || !current_year) {
    // Return 400 Bad Request if required fields are missing
    return res.status(400).json({ message: 'Missing required student fields (ID, Name, Email, Password, Dept, Year).' });
  }

  try {
    // Hash the password before storing
    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);

    const query = `
      INSERT INTO "student"
        (student_id, first_name, last_name, email, password_hash, admission_date, department, current_year, status)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING student_id, first_name, last_name, email, admission_date, department, current_year, status; -- Return the created student (without hash)
    `;
    const values = [
      student_id, first_name, last_name, email, password_hash,
      admission_date || new Date(), // Default admission date if not provided
      department, parseInt(current_year, 10), // Ensure year is integer
      status || 'Active' // Default status if not provided
    ];

    const result = await pool.query(query, values);
    // Send 201 Created status on success
    res.status(201).json(result.rows[0]); // Send back the newly created student data

  } catch (error) {
    console.error('Database error adding student:', error);
    // Handle potential duplicate key errors (e.g., email or student_id already exists)
    if (error.code === '23505') { // Unique constraint violation code for PostgreSQL
        // Return 409 Conflict status
        return res.status(409).json({ message: `Student with ID ${student_id} or email ${email} already exists.` });
    }
    // Return 500 Internal Server Error for other database issues
    res.status(500).json({ message: 'An internal server error occurred while adding the student.' });
  }
});

// --- CURRENT ATTENDANCE ENDPOINT ---
app.get('/api/attendance/:studentId/current', async (req, res) => {
  const { studentId } = req.params;
  console.log(`--- Request received for CURRENT attendance for student ${studentId} ---`);

  if (!studentId) {
     return res.status(400).json({ message: 'Student ID is required.' }); // Added proper error handling
  }

  try {
    // === Step 1: Find latest semester ID ===
    const latestSemesterQuery = `SELECT MAX(semester_id) as latest_sem_id FROM "enrollment" WHERE student_id = $1;`;
    const semesterResult = await pool.query(latestSemesterQuery, [studentId]);
    const latestSemesterId = semesterResult.rows[0]?.latest_sem_id;

    if (!latestSemesterId) {
      console.log(`No enrollments found for student ${studentId}, returning empty attendance.`);
      // Return default empty state
      return res.status(200).json({
        summary: { overallRate: '0.0', totalClasses: 0, classesAttended: 0, totalAbsences: 0 },
        details: [],
        recent: [] // Also return empty recent
      });
    }
     console.log(`Latest semester ID for ${studentId} is ${latestSemesterId}`); // Added log

    // === Step 2: Query for all attendance records for that semester ===
    const attendanceQuery = `
      SELECT e.course_id, c.course_name, a.status, a.class_date
      FROM "attendance" a
      JOIN "enrollment" e ON a.enrollment_id = e.enrollment_id
      JOIN "course" c ON e.course_id = c.course_id
      WHERE e.student_id = $1 AND e.semester_id = $2;
    `;
    const attendanceResult = await pool.query(attendanceQuery, [studentId, latestSemesterId]);
    const allRecords = attendanceResult.rows;

    // === Step 3: Calculate Overall Summary ===
    let totalClassesOverall = allRecords.length, attendedClassesOverall = 0, absentClassesOverall = 0;
    allRecords.forEach(record => {
      if (record.status === 'Present' || record.status === 'Late') attendedClassesOverall++;
      if (record.status === 'Absent') absentClassesOverall++;
    });
    const overallRate = totalClassesOverall === 0 ? 0 : (attendedClassesOverall / totalClassesOverall) * 100;
    const summary = {
      overallRate: overallRate.toFixed(1), totalClasses: totalClassesOverall,
      classesAttended: attendedClassesOverall, totalAbsences: absentClassesOverall
    };

    // === Step 4: Calculate Per-Course Details ===
    const detailsMap = new Map();
    allRecords.forEach(record => {
      if (!detailsMap.has(record.course_id)) {
        detailsMap.set(record.course_id, {
          course_id: record.course_id, course_name: record.course_name,
          total: 0, present: 0, absent: 0, late: 0, attended: 0
        });
      }
      const courseStat = detailsMap.get(record.course_id);
      courseStat.total++;
      if (record.status === 'Present') courseStat.present++;
      if (record.status === 'Absent') courseStat.absent++;
      if (record.status === 'Late') courseStat.late++;
      if (record.status === 'Present' || record.status === 'Late') courseStat.attended++;
    });
    const details = Array.from(detailsMap.values()).map(stat => ({
      ...stat, percentage: stat.total === 0 ? 0 : (stat.attended / stat.total) * 100
    }));

    console.log(`Calculated attendance summary and ${details.length} course details for student ${studentId}, semester ${latestSemesterId}`);

    // === Step 5: Send Combined Data ===
    res.status(200).json({ summary, details, recent: allRecords }); // Includes recent records

  } catch (error) {
    console.error(`Database error fetching current attendance for student ${studentId}:`, error);
    res.status(500).json({ message: 'An internal server error occurred while fetching attendance.' });
  }
});

// --- ADMIN DASHBOARD STATS ENDPOINT ---
app.get('/api/admin/dashboard-stats', async (req, res) => {
  console.log(`--- Request received for Admin Dashboard Stats ---`);

  try {
    // --- Query 1: Total Students ---
    const studentCountQuery = 'SELECT COUNT(student_id) AS total_students FROM "student" WHERE status = \'Active\';';
    const studentCountResult = await pool.query(studentCountQuery);
    const totalStudents = parseInt(studentCountResult.rows[0]?.total_students || 0);

    // --- Query 2: Active Courses ---
    const courseCountQuery = 'SELECT COUNT(course_id) AS active_courses FROM "course" WHERE status = \'Active\';';
    const courseCountResult = await pool.query(courseCountQuery);
    const activeCourses = parseInt(courseCountResult.rows[0]?.active_courses || 0);

    // --- Query 3: Faculty Members ---
    const facultyCountQuery = 'SELECT COUNT(DISTINCT faculty_name) AS faculty_members FROM "course" WHERE status = \'Active\' AND faculty_name IS NOT NULL;'; // Assuming lowercase table name
    const facultyCountResult = await pool.query(facultyCountQuery);
    const facultyMembers = parseInt(facultyCountResult.rows[0]?.faculty_members || 0);

    // --- Query 4: Average Attendance ---
    const avgAttendanceQuery = `
      SELECT
        CASE
          WHEN COUNT(a.attendance_id) = 0 THEN 0
          ELSE (COUNT(CASE WHEN a.status IN ('Present', 'Late') THEN 1 ELSE NULL END) * 100.0 / COUNT(a.attendance_id))
        END AS average_attendance
      FROM "attendance" a;
    `;
    const avgAttendanceResult = await pool.query(avgAttendanceQuery);
    const averageAttendance = parseFloat(avgAttendanceResult.rows[0]?.average_attendance || 0).toFixed(1);

    console.log(`Admin Stats: Students=${totalStudents}, Courses=${activeCourses}, Faculty=${facultyMembers}, AvgAttend=${averageAttendance}%`);

    // === Send the Combined Stats ===
    res.status(200).json({
      totalStudents,
      activeCourses,
      facultyMembers,
      averageAttendance
    });

  } catch (error) {
    console.error(`Database error fetching admin dashboard stats:`, error);
    res.status(500).json({ message: 'An internal server error occurred while fetching admin stats.' });
  }
});

app.delete('/api/students/:studentId', async (req, res) => {
  const { studentId } = req.params;
  console.log(`--- Request received to DELETE student: ${studentId} ---`);

  if (!studentId) {
    return res.status(400).json({ message: 'Student ID is required.' });
  }

  try {
    // Note: Deleting a student might fail if they have related records
    // (e.g., enrollments) due to foreign key constraints.
    // Handling this might require deleting related records first or setting status to 'Inactive'.
    const query = 'DELETE FROM "student" WHERE student_id = $1 RETURNING student_id;';
    const result = await pool.query(query, [studentId]);

    // Check if any row was actually deleted
    if (result.rowCount === 0) {
      return res.status(404).json({ message: `Student with ID ${studentId} not found.` });
    }

    // Send success response
    res.status(200).json({ message: `Student ${studentId} deleted successfully.` });

  } catch (error) {
    console.error(`Database error deleting student ${studentId}:`, error);
     // Handle foreign key constraint violations (PostgreSQL error code '23503')
     if (error.code === '23503') {
        return res.status(409).json({ message: `Cannot delete student ${studentId} because they have existing enrollment or related records.` });
    }
    // Send generic server error for other issues
    res.status(500).json({ message: 'An internal server error occurred while deleting the student.' });
  }
});

app.get('/api/admin/courses-overview', async (req, res) => {
  console.log('--- Request received for Admin Course Overview ---');
  try {
    // --- We'll run all our queries in parallel for speed ---
    const [
      totalCoursesRes,
      activeCoursesRes,
      totalEnrollmentRes,
      coursesListRes
    ] = await Promise.all([
      // Query 1: Total Courses (All statuses)
      pool.query('SELECT COUNT(course_id) AS total_courses FROM "course";'),
      
      // Query 2: Active Courses
      pool.query('SELECT COUNT(course_id) AS active_courses FROM "course" WHERE status = \'Active\';'),
      
      // Query 3: Total Enrollments (All students, all courses)
      pool.query('SELECT COUNT(enrollment_id) AS total_enrollments FROM "enrollment";'),
      
      // Query 4: Get Full Course List with Individual Enrollment Counts
      // We use a LEFT JOIN to include courses with 0 enrollments
      // and GROUP BY to get the count for each course.
      pool.query(`
        SELECT
            c.course_id, c.course_name, c.credit_hours, c.faculty_name,
            c.department, c.schedule, c.status,
            COUNT(e.enrollment_id) AS "enrollmentCount"
        FROM "course" c
        LEFT JOIN "enrollment" e ON c.course_id = e.course_id
        GROUP BY c.course_id
        ORDER BY c.course_id;
      `)
    ]);

    // --- Process Stats ---
    const totalCourses = parseInt(totalCoursesRes.rows[0]?.total_courses || 0);
    const activeCourses = parseInt(activeCoursesRes.rows[0]?.active_courses || 0);
    const totalEnrollment = parseInt(totalEnrollmentRes.rows[0]?.total_enrollments || 0);
    const avgClassSize = totalCourses > 0 ? Math.round(totalEnrollment / totalCourses) : 0;

    // --- Process Course List ---
    // Convert the string count from SQL to a number
    const formattedCourses = coursesListRes.rows.map(course => ({
      ...course,
      enrollmentCount: parseInt(course.enrollmentCount, 10)
    }));

    // --- Send the combined response ---
    res.status(200).json({
      stats: {
        totalCourses: totalCourses,
        activeCourses: activeCourses,
        totalEnrollment: totalEnrollment,
        avgClassSize: avgClassSize,
      },
      courses: formattedCourses,
    });

  } catch (error) {
    console.error('Database error fetching course overview:', error);
    res.status(500).json({ message: 'An internal server error occurred while fetching course overview.' });
  }
});

// --- CREATE NEW COURSE ENDPOINT ---
app.post('/api/courses', async (req, res) => {
  // 1. Extract data from request body
  const { 
    course_id, course_name, credit_hours, faculty_name, 
    department, schedule, status 
  } = req.body;
  
  console.log(`--- Request received to ADD course: ${course_id} ---`);

  // 2. Validation (same as your /api/students endpoint)
  if (!course_id || !course_name || !credit_hours || !department || !status) {
    return res.status(400).json({ message: 'Missing required course fields (ID, Name, Credits, Dept, Status).' });
  }

  try {
    // 3. Create the SQL Query
    const query = `
      INSERT INTO "course"
        (course_id, course_name, credit_hours, faculty_name, department, schedule, status)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *; -- Return the full created course
    `;
    
    // 4. Create the values array (ensure credit_hours is a number)
    const values = [
      course_id,
      course_name,
      Number(credit_hours), // Frontend sends a string for type="number"
      faculty_name,
      department,
      schedule,
      status
    ];

    // 5. Execute the query
    const result = await pool.query(query, values);

    // 6. Send 201 Created status on success
    res.status(201).json(result.rows[0]); // Send back the newly created course

  } catch (error) {
    console.error('Database error adding course:', error);
    // Handle duplicate key error (same as your /api/students endpoint)
    if (error.code === '23505') { // Unique constraint violation
      return res.status(4.9).json({ message: `A course with ID ${course_id} already exists.` });
    }
    // General server error
    res.status(500).json({ message: 'An internal server error occurred while adding the course.' });
  }
});

app.delete('/api/courses/:courseId', async (req, res) => {
  // 1. Get the course_id from the URL parameters
  const { courseId } = req.params;
  console.log(`--- Request received to DELETE course: ${courseId} ---`);

  if (!courseId) {
    return res.status(400).json({ message: 'Course ID is required.' });
  }

  try {
    // 2. Execute the DELETE query
    const query = 'DELETE FROM "course" WHERE course_id = $1 RETURNING course_id;';
    const result = await pool.query(query, [courseId]);

    // 3. Check if any row was actually deleted
    if (result.rowCount === 0) {
      return res.status(404).json({ message: `Course with ID ${courseId} not found.` });
    }

    // 4. Send success response
    res.status(200).json({ message: `Course ${courseId} deleted successfully.` });

  } catch (error) {
    console.error(`Database error deleting course ${courseId}:`, error);
    
    // 5. Handle foreign key constraint violations (PostgreSQL error code '23503')
    // This happens if you try to delete a course that has enrollments
    if (error.code === '23503') {
      return res.status(409).json({ message: `Cannot delete course ${courseId}. It has existing enrollments.` });
    }
    
    // Send generic server error for other issues
    res.status(500).json({ message: 'An internal server error occurred while deleting the course.' });
  }
});

// --- UPDATE AN EXISTING COURSE ENDPOINT ---
app.put('/api/courses/:courseId', async (req, res) => {
  // 1. Get the course_id from the URL parameters
  const { courseId } = req.params;
  
  // 2. Get the new course data from the request body
  const { 
    course_name, credit_hours, faculty_name, 
    department, schedule, status 
  } = req.body;

  console.log(`--- Request received to UPDATE course: ${courseId} ---`);

  // 3. Validation
  if (!course_name || !credit_hours || !department || !status) {
    return res.status(400).json({ message: 'Missing required course fields (Name, Credits, Dept, Status).' });
  }

  try {
    // 4. Create the UPDATE query
    const query = `
      UPDATE "course"
      SET 
        course_name = $1,
        credit_hours = $2,
        faculty_name = $3,
        department = $4,
        schedule = $5,
        status = $6
      WHERE 
        course_id = $7
      RETURNING *; -- Return the full updated course
    `;
    
    // 5. Create the values array
    const values = [
      course_name,
      Number(credit_hours),
      faculty_name,
      department,
      schedule,
      status,
      courseId // The $7 parameter
    ];

    // 6. Execute the query
    const result = await pool.query(query, values);

    // 7. Check if any row was actually updated
    if (result.rowCount === 0) {
      return res.status(404).json({ message: `Course with ID ${courseId} not found.` });
    }

    // 8. Send success response
    res.status(200).json(result.rows[0]); // Send back the updated course data

  } catch (error) {
    console.error(`Database error updating course ${courseId}:`, error);
    res.status(500).json({ message: 'An internal server error occurred while updating the course.' });
  }
});

app.get('/api/enrollment-data', async (req, res) => {
  console.log('--- Request received for enrollment data (courses and semesters) ---');
  try {
    const [coursesRes, semestersRes] = await Promise.all([
      // Get a simple list of all courses
      pool.query('SELECT course_id, course_name FROM "course" ORDER BY course_id;'),
      // Get a simple list of all semesters
      pool.query('SELECT semester_id, semester_name FROM "semester" ORDER BY semester_id;')
    ]);

    res.status(200).json({
      courses: coursesRes.rows,
      semesters: semestersRes.rows,
    });

  } catch (error) {
    console.error('Database error fetching enrollment data:', error);
    res.status(500).json({ message: 'An internal server error occurred.' });
  }
});

// --- CREATE A NEW ENROLLMENT ---
app.post('/api/enrollments', async (req, res) => {
  // 1. Extract the three required IDs from the body
  const { student_id, course_id, semester_id } = req.body;
  console.log(`--- Request received to ENROLL student ${student_id} in course ${course_id} for sem ${semester_id} ---`);

  // 2. Validation
  if (!student_id || !course_id || !semester_id) {
    return res.status(400).json({ message: 'Student ID, Course ID, and Semester ID are all required.' });
  }

  try {
    // 3. Create the INSERT query
    // We can use COALESCE to automatically set the enrollment_id
    const query = `
      INSERT INTO "enrollment" (enrollment_id, student_id, course_id, semester_id)
      VALUES (
        COALESCE((SELECT MAX(enrollment_id) + 1 FROM "enrollment"), 1001), 
        $1, $2, $3
      )
      RETURNING *; -- Return the new enrollment
    `;
    const values = [student_id, course_id, semester_id];

    // 4. Execute
    const result = await pool.query(query, values);

    // 5. Success
    res.status(201).json(result.rows[0]);

  } catch (error) {
    console.error('Database error creating enrollment:', error);
    // 23505 = unique_violation (student already enrolled in that course)
    if (error.code === '23505') { 
      return res.status(409).json({ message: 'This student is already enrolled in this course.' });
    }
    res.status(500).json({ message: 'An internal server error occurred.' });
  }
});


// --- ADMIN REPORTS DATA ENDPOINT ---
app.get('/api/admin/reports-data', async (req, res) => {
  console.log('--- Request received for Admin Reports Data ---');
  try {
    // --- Run multiple queries in parallel ---
    const [
      keyMetricsRes,
      // enrollmentTrendRes, // Placeholder - requires date logic not easily done here
      // weeklyAttendanceRes, // Placeholder - requires date logic
      departmentDistRes,
      performanceDistRes,
    ] = await Promise.all([
      // 1. Key Metrics (Re-use some logic from dashboard stats)
      Promise.all([
        pool.query('SELECT COUNT(enrollment_id) AS total_enrollments FROM "enrollment";'), // Total Enrollments
        pool.query('SELECT COUNT(course_id) AS active_courses FROM "course" WHERE status = \'Active\';'), // Active Courses
        pool.query(`
          SELECT
            CASE WHEN COUNT(a.attendance_id) = 0 THEN 0
            ELSE (COUNT(CASE WHEN a.status IN ('Present', 'Late') THEN 1 ELSE NULL END) * 100.0 / COUNT(a.attendance_id))
            END AS average_attendance
          FROM "attendance" a;
        `), // Average Attendance
        pool.query('SELECT COALESCE(AVG(gpa_point), 0) AS average_gpa FROM "grade";'), // Average GPA
      ]),

      // 2. Enrollment Trend (Placeholder - Needs more complex date grouping)
      // pool.query(`SELECT TO_CHAR(admission_date, 'Mon') as month, COUNT(student_id) as students FROM "student" WHERE admission_date >= date_trunc('year', CURRENT_DATE) GROUP BY month ORDER BY MIN(admission_date);`),

      // 3. Weekly Attendance (Placeholder - Needs complex day-of-week grouping)
      // pool.query(`SELECT TO_CHAR(class_date, 'Dy') as day, AVG(CASE WHEN status IN ('Present', 'Late') THEN 100.0 ELSE 0 END) as percentage FROM "attendance" WHERE class_date >= CURRENT_DATE - INTERVAL '1 month' GROUP BY day ORDER BY EXTRACT(DOW FROM class_date);`),

      // 4. Department Distribution
      pool.query(`
        SELECT department, COUNT(student_id) AS value
        FROM "student"
        WHERE status = 'Active' -- Count only active students per department
        GROUP BY department
        ORDER BY department;
      `),

      // 5. Performance (GPA) Distribution
      // 5. Performance (GPA) Distribution (10-Point Scale)
      pool.query(`
        WITH student_avg_gpa AS (
          -- Calculate overall CGPA for each student (average across all their grades)
          SELECT e.student_id, COALESCE(AVG(g.gpa_point), 0) as avg_cgpa
          FROM "enrollment" e
          LEFT JOIN "grade" g ON e.enrollment_id = g.enrollment_id
          GROUP BY e.student_id
        )
        SELECT
          CASE
            WHEN avg_cgpa >= 9.0 THEN '9.0-10.0 (O/A+)' -- <<< NEW RANGES
            WHEN avg_cgpa >= 8.0 THEN '8.0-8.9 (A)'    -- <<< NEW RANGES
            WHEN avg_cgpa >= 7.0 THEN '7.0-7.9 (B+)'   -- <<< NEW RANGES
            WHEN avg_cgpa >= 6.0 THEN '6.0-6.9 (B)'    -- <<< NEW RANGES
            WHEN avg_cgpa >= 5.0 THEN '5.0-5.9 (C)'    -- <<< NEW RANGES
            ELSE 'Below 5.0 (Fail)'                     -- <<< NEW RANGES
          END AS range,
          COUNT(student_id) AS students
        FROM student_avg_gpa
        GROUP BY
          CASE
            WHEN avg_cgpa >= 9.0 THEN '9.0-10.0 (O/A+)' -- <<< NEW RANGES
            WHEN avg_cgpa >= 8.0 THEN '8.0-8.9 (A)'    -- <<< NEW RANGES
            WHEN avg_cgpa >= 7.0 THEN '7.0-7.9 (B+)'   -- <<< NEW RANGES
            WHEN avg_cgpa >= 6.0 THEN '6.0-6.9 (B)'    -- <<< NEW RANGES
            WHEN avg_cgpa >= 5.0 THEN '5.0-5.9 (C)'    -- <<< NEW RANGES
            ELSE 'Below 5.0 (Fail)'                     -- <<< NEW RANGES
          END
        ORDER BY MIN(avg_cgpa) DESC; -- Order from highest range to lowest
      `),
    ]);

    // --- Process Key Metrics ---
    const [
      totalEnrollmentRes,
      activeCoursesRes,
      avgAttendanceRes,
      avgGpaRes,
    ] = keyMetricsRes; // Destructure results

    const keyMetrics = {
      totalEnrollment: parseInt(totalEnrollmentRes.rows[0]?.total_enrollments || 0),
      activeCourses: parseInt(activeCoursesRes.rows[0]?.active_courses || 0),
      averageAttendance: parseFloat(avgAttendanceRes.rows[0]?.average_attendance || 0).toFixed(1),
      averageGpa: parseFloat(avgGpaRes.rows[0]?.average_gpa || 0).toFixed(2),
      // Mocked trend data for now
      enrollmentTrend: { value: 8.4, direction: 'up' }, // Example
      attendanceTrend: { value: 3, direction: 'up' }, // Example
    };

    // --- Process Department Distribution ---
    // Assign colors based on your frontend (needs manual mapping or a better approach)
    const deptColors = {
        'CMPN': "#3b82f6", // Blue
        'IT':   "#10b981", // Green
        'EXCS': "#8b5cf6", // Purple
        'EXTC': "#f59e0b", // Amber
        // Add defaults if needed
    };
    const departmentDistribution = departmentDistRes.rows.map(row => ({
      name: row.department,
      value: parseInt(row.value, 10),
      color: deptColors[row.department] || "#6b7280" // Gray fallback
    }));
     // Ensure all departments are present, even with 0 students
     const allDepts = ['CMPN', 'IT', 'EXCS', 'EXTC'];
     allDepts.forEach(deptName => {
        if (!departmentDistribution.some(d => d.name === deptName)) {
            departmentDistribution.push({
                name: deptName,
                value: 0,
                color: deptColors[deptName] || "#6b7280"
            });
        }
     });
     // Sort alphabetically for consistent pie chart order
     departmentDistribution.sort((a, b) => a.name.localeCompare(b.name));


    // --- Process Performance Distribution ---
    const performanceDistribution = performanceDistRes.rows.map(row => ({
      range: row.range,
      students: parseInt(row.students, 10),
    }));

    // --- Send Combined Data ---
    res.status(200).json({
      keyMetrics,
      // enrollmentTrend: enrollmentTrendRes?.rows || [], // Send empty if query fails/commented out
      enrollmentTrend: [ // MOCKED until DB schema supports it better
        { month: "Jan", students: keyMetrics.totalEnrollment * 0.9 }, // Example calculation
        { month: "Feb", students: keyMetrics.totalEnrollment * 0.92 },
        { month: "Mar", students: keyMetrics.totalEnrollment * 0.94 },
        { month: "Apr", students: keyMetrics.totalEnrollment * 0.95 },
        { month: "May", students: keyMetrics.totalEnrollment * 0.96 },
        { month: "Jun", students: keyMetrics.totalEnrollment * 0.97 },
        { month: "Jul", students: keyMetrics.totalEnrollment * 0.98 },
        { month: "Aug", students: keyMetrics.totalEnrollment * 0.99 },
        { month: "Sep", students: keyMetrics.totalEnrollment },
        { month: "Oct", students: keyMetrics.totalEnrollment }, // Assume current month has total
      ].map(m => ({...m, students: Math.round(m.students)})), // Round students

      // weeklyAttendance: weeklyAttendanceRes?.rows || [], // Send empty if query fails/commented out
      weeklyAttendance: [ // MOCKED until DB schema supports it better
        { day: "Mon", percentage: parseFloat(keyMetrics.averageAttendance) + 1 },
        { day: "Tue", percentage: parseFloat(keyMetrics.averageAttendance) + 2 },
        { day: "Wed", percentage: parseFloat(keyMetrics.averageAttendance) + 0 },
        { day: "Thu", percentage: parseFloat(keyMetrics.averageAttendance) - 1 },
        { day: "Fri", percentage: parseFloat(keyMetrics.averageAttendance) - 2 },
      ].map(d => ({...d, percentage: Math.max(0, Math.min(100, d.percentage)).toFixed(1)})), // Clamp and format

      departmentDistribution,
      performanceDistribution,
    });

  } catch (error) {
    console.error('Database error fetching reports data:', error);
    res.status(500).json({ message: 'An internal server error occurred.' });
  }
});

// 6. Start the server
app.listen(PORT, () => {
  console.log(`✅ Backend server is running on http://localhost:${PORT}`);
});

