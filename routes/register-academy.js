import express from 'express';
import nodemailer from 'nodemailer';
import pool from '../database/connection.js';

const router = express.Router();

// Configure nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'theblackroom.us@gmail.com',
    pass: process.env.EMAIL_PASSWORD // App password from Gmail
  },
  secure: true,
  port: 465
});

// Verify transporter configuration
transporter.verify(function(error, success) {
  if (error) {
    console.log('❌ Email configuration error:', error);
  } else {
    console.log('✅ Email server is ready to send messages');
  }
});

router.post("/", async (req, res) => {
  const { name, email, phone, course } = req.body;

  if (!name || !email || !phone || !course) {
    return res.status(400).json({ message: "All fields are required" });
  }

  try {
    // Save registration to PostgreSQL (persistent storage)
    await pool.query(
      'INSERT INTO academy_registrations (name, email, phone, course) VALUES ($1, $2, $3, $4)',
      [name, email.toLowerCase(), phone, course]
    );
    console.log(`✅ Academy registration saved to DB: ${name} (${email})`);

    // Send confirmation email to user
    const userMailOptions = {
      from: '"Black Room Academy" <theblackroom.us@gmail.com>',
      to: email,
      subject: 'Welcome to Black Room Academy! 🎵',
      headers: {
        'X-Priority': '3',
        'X-Mailer': 'Black Room Academy System'
      },
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #000; color: #fff; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #00ff88; margin: 0;">BLACK ROOM ACADEMY</h1>
          </div>

          <h2 style="color: #00ff88;">Welcome ${name}!</h2>

          <p>Thank you for your interest in Black Room Academy. We're excited to have you join our community!</p>

          <div style="background: #111; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #00ff88; margin-top: 0;">Registration Details:</h3>
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Phone:</strong> ${phone}</p>
            <p><strong>Course:</strong> ${course === 'basic' ? 'Basic Course' : 'Intermediate Course'}</p>
          </div>

          <p>You've been added to our waiting list for the next available course. We'll contact you soon with more details about your course schedule and next steps.</p>

          <p style="margin: 30px 0;">Our academy exists to strengthen our mission: revolutionizing Miami's techno scene by building the largest techno community and empowering new artists.</p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="https://your-domain.com" style="background: #00ff88; color: #000; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Visit Black Room</a>
          </div>

          <p style="font-size: 14px; color: #ccc; text-align: center; margin-top: 40px;">
            Black Room Academy<br>
            Revolutionizing Miami's Techno Scene
          </p>
        </div>
      `
    };

    // Send notification email to Black Room team
    const adminMailOptions = {
      from: '"Black Room Academy" <theblackroom.us@gmail.com>',
      to: 'theblackroom.us@gmail.com',
      subject: `New Academy Registration: ${name}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #00ff88;">New Academy Registration</h2>

          <div style="background: #f5f5f5; padding: 20px; border-radius: 8px;">
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Phone:</strong> ${phone}</p>
            <p><strong>Course:</strong> ${course === 'basic' ? 'Basic Course' : 'Intermediate Course'}</p>
            <p><strong>Registration Date:</strong> ${new Date().toLocaleString()}</p>
          </div>

          <p>Please follow up with this student to schedule their course.</p>
        </div>
      `
    };

    // Send both emails with better error handling
    try {
      const userEmailResult = await transporter.sendMail(userMailOptions);
      console.log('✅ User email sent:', userEmailResult.messageId);
      
      const adminEmailResult = await transporter.sendMail(adminMailOptions);
      console.log('✅ Admin email sent:', adminEmailResult.messageId);
      
      console.log(`✅ Academy registration emails sent for: ${name} (${email})`);
    } catch (emailError) {
      console.error('❌ Email sending failed:', emailError);
      // Still save the registration but warn about email failure
      console.log('⚠️ Registration saved but email notification failed');
    }

    // Return success response
    res.status(200).json({ 
      success: true, 
      message: 'Registration successful! Check your email for confirmation.' 
    });
  } catch (error) {
    console.error('❌ Error in academy registration:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Registration failed. Please try again.' 
    });
  }
});

export default router;