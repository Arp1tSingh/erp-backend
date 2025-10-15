// backend/hashPassword.js
const bcrypt = require('bcryptjs');
const password = 'adminpassword123';
const saltRounds = 10;

bcrypt.hash(password, saltRounds, (err, hash) => {
  if (err) {
    console.error('Error hashing password:', err);
  } else {
    console.log('Your hashed password is:', hash);
  }
});