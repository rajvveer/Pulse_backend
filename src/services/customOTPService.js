const nodemailer = require('nodemailer');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const OTP = require('../models/OTP');
const cacheService = require('./cacheService');

class CustomOTPService {
  constructor() {
    // Email transporter setup
    this.emailTransporter = null;
    
    if (process.env.YOUR_EMAIL && process.env.YOUR_EMAIL_APP_PASSWORD) {
      this.emailTransporter = nodemailer.createTransport({
        service: 'gmail',
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: {
          user: process.env.YOUR_EMAIL,
          pass: process.env.YOUR_EMAIL_APP_PASSWORD
        },
        pool: true,
        maxConnections: 5,
        maxMessages: 100,
        rateLimit: 10
      });

      // Verify email connection
      this.emailTransporter.verify((error, success) => {
        if (error) {
          console.error('❌ Email SMTP connection failed:', error.message);
        } else {
          console.log('✅ Email SMTP server ready for OTP');
        }
      });
    } else {
      console.warn('⚠️  Email credentials not configured - email OTP disabled');
    }

    // MSG91 SMS configuration
    this.msg91Config = {
      authKey: process.env.MSG91_AUTH_KEY,
      senderId: process.env.MSG91_SENDER_ID || 'PULSE',
      route: process.env.MSG91_ROUTE || '4',
      country: process.env.MSG91_COUNTRY || '91'
    };

    if (this.msg91Config.authKey) {
      console.log('✅ MSG91 SMS service configured');
    } else {
      console.warn('⚠️  MSG91 credentials not configured - SMS OTP disabled');
    }
  }

  // Generate random OTP
  generateOTP(length = 6) {
    const digits = '0123456789';
    let otp = '';
    for (let i = 0; i < length; i++) {
      otp += digits[crypto.randomInt(0, digits.length)];
    }
    return otp;
  }

  // Rate limiting check
  async checkRateLimit(identifier, type, maxAttempts = 5, windowMs = 15 * 60 * 1000) {
    try {
      const key = `otp_rate_limit:${type}:${identifier}`;
      const attempts = await cacheService.incrementRateLimit(key, Math.floor(windowMs / 1000));
      
      if (attempts > maxAttempts) {
        throw new Error(`Too many OTP requests. Please try again after ${Math.floor(windowMs / 60000)} minutes.`);
      }
      
      return attempts;
    } catch (error) {
      if (error.message.includes('Too many')) {
        throw error;
      }
      console.warn('Rate limiting check failed, continuing:', error.message);
      return 1;
    }
  }

  // 📧 EMAIL OTP - Send email OTP
  async sendEmailOTP(email, purpose = 'login', userId = null, ipAddress = '127.0.0.1') {
    try {
      if (!this.emailTransporter) {
        throw new Error('Email OTP not configured. Please set YOUR_EMAIL and YOUR_EMAIL_APP_PASSWORD in .env file');
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        throw new Error('Please enter a valid email address');
      }

      // Rate limiting check
      await this.checkRateLimit(email, 'email');
      
      // Generate OTP
      const otp = this.generateOTP(6);
      const hashedOTP = await bcrypt.hash(otp, 10);
      
      // Store in database
      await OTP.create({
        userId,
        identifier: email.toLowerCase(),
        type: 'email',
        purpose,
        hashedCode: hashedOTP,
        ipAddress,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
        maxAttempts: 3
      });

      // Email template
      const subject = this.getEmailSubject(purpose);
      const html = this.getEmailTemplate(purpose, otp);

      // Send email
      const result = await this.emailTransporter.sendMail({
        from: {
          name: 'Pulse',
          address: process.env.YOUR_EMAIL
        },
        to: email,
        subject: subject,
        html: html
      });
      
      console.log(`📧 Email OTP sent to ${email} for ${purpose}`);
      
      return {
        success: true,
        identifier: email.toLowerCase(),
        type: 'email',
        purpose,
        expiresIn: '10 minutes',
        message: `OTP sent to ${email}`
      };

    } catch (error) {
      console.error('Email OTP send error:', error.message);
      throw new Error(`Failed to send email OTP: ${error.message}`);
    }
  }

  // 📱 SMS OTP - Send SMS OTP via MSG91
  async sendSMSOTP(phone, purpose = 'login', userId = null, ipAddress = '127.0.0.1') {
  try {
    if (!this.msg91Config.authKey) {
      throw new Error('SMS OTP not configured. Please set MSG91_AUTH_KEY in .env file');
    }

    // Clean and validate phone number
    const cleanPhone = phone.replace(/\D/g, '');
    if (!cleanPhone.match(/^[6-9]\d{9}$/)) {
      throw new Error('Please enter a valid Indian mobile number (10 digits starting with 6-9)');
    }

    const fullPhone = `91${cleanPhone}`; // Add country code

    // Rate limiting check
    await this.checkRateLimit(fullPhone, 'sms');
    
    // Generate OTP
    const otp = this.generateOTP(6);
    const hashedOTP = await bcrypt.hash(otp, 10);
    
    // Store in database
    await OTP.create({
      userId,
      identifier: fullPhone,
      type: 'sms',
      purpose,
      hashedCode: hashedOTP,
      ipAddress,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
      maxAttempts: 3
    });

    console.log('🔍 SMS DEBUG - Using MSG91 OTP API:');
    console.log('📱 Full phone:', fullPhone);
    console.log('📱 OTP generated:', otp);

    // 🚀 USE MSG91 OTP API (bypasses DLT for OTP messages)
    const otpApiUrl = 'https://api.msg91.com/api/v5/otp';
    const otpPayload = {
      mobile: fullPhone,
      authkey: this.msg91Config.authKey,
      otp: otp,
      template_id: process.env.MSG91_OTP_TEMPLATE_ID || 'default'
    };

    console.log('📱 OTP API URL:', otpApiUrl);
    console.log('📱 OTP API Payload:', { ...otpPayload, otp: 'HIDDEN' });

    try {
      const response = await axios.post(otpApiUrl, otpPayload, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      console.log('📱 MSG91 OTP API Response Status:', response.status);
      console.log('📱 MSG91 OTP API Response:', response.data);
      
      if (response.data && response.data.type === 'success') {
        console.log('✅ MSG91 OTP sent successfully');
      } else {
        console.log('⚠️ MSG91 OTP API Response:', response.data);
      }

    } catch (axiosError) {
      console.error('❌ MSG91 OTP API Error:', axiosError.response?.data || axiosError.message);
      
      // Fallback: If OTP API fails, try simple SMS without DLT
      console.log('🔄 Trying fallback SMS method...');
      
      const fallbackUrl = 'https://api.msg91.com/api/sendhttp.php';
      const fallbackParams = new URLSearchParams({
        authkey: this.msg91Config.authKey,
        mobiles: fullPhone,
        message: `${otp} is your OTP for Pulse. Valid for 5 minutes.`,
        sender: 'MSGIND',
        route: 4, // Promotional route
        country: 91
      });

      const fallbackResponse = await axios.post(fallbackUrl, fallbackParams);
      console.log('📱 Fallback SMS Response:', fallbackResponse.data);
    }
    
    return {
      success: true,
      identifier: fullPhone,
      type: 'sms',
      purpose,
      expiresIn: '5 minutes',
      message: `OTP sent to +${fullPhone}`
    };

  } catch (error) {
    console.error('SMS OTP send error:', error.message);
    throw new Error(`Failed to send SMS OTP: ${error.message}`);
  }
}



  // Email templates
  getEmailSubject(purpose) {
    const subjects = {
      signup: '🎉 Welcome to Pulse - Verify Your Email',
      login: '🔐 Pulse Login Verification Code',
      password_reset: '🔑 Reset Your Pulse Password',
      verification: '✅ Verify Your Pulse Account'
    };
    return subjects[purpose] || subjects.login;
  }

  getEmailTemplate(purpose, otp) {
    const templates = {
      signup: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #4CAF50;">Welcome to Pulse! 🎉</h2>
          <p>Thank you for joining Pulse. Your verification code is:</p>
          <div style="background: #f5f5f5; padding: 20px; text-align: center; margin: 20px 0;">
            <h1 style="color: #333; font-size: 36px; margin: 0; letter-spacing: 8px;">${otp}</h1>
          </div>
          <p>This code will expire in <strong>10 minutes</strong>.</p>
          <p>If you didn't create an account, please ignore this email.</p>
          <hr style="margin: 30px 0;">
          <p style="color: #888; font-size: 12px;">This is an automated message from Pulse. Please do not reply.</p>
        </div>
      `,
      login: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2196F3;">Pulse Login Verification 🔐</h2>
          <p>Your login verification code is:</p>
          <div style="background: #f5f5f5; padding: 20px; text-align: center; margin: 20px 0;">
            <h1 style="color: #333; font-size: 36px; margin: 0; letter-spacing: 8px;">${otp}</h1>
          </div>
          <p>This code will expire in <strong>10 minutes</strong>.</p>
          <p>If you didn't request this code, please secure your account immediately.</p>
          <hr style="margin: 30px 0;">
          <p style="color: #888; font-size: 12px;">This is an automated message from Pulse. Please do not reply.</p>
        </div>
      `
    };
    return templates[purpose] || templates.login;
  }

  // SMS message templates
  getSMSTemplate(purpose, otp) {
  const templates = {
    signup: `${otp} is your Pulse verification code. Valid for 5 minutes.`,
    login: `${otp} is your Pulse login code. Valid for 5 minutes.`
  };
  return templates[purpose] || templates.login;
}


  // Verify OTP
  async verifyOTP(identifier, inputOTP, purpose, ipAddress = '127.0.0.1') {
    try {
      console.log(`🔍 DEBUG: Verifying OTP for ${identifier}`);
      console.log(`🔍 DEBUG: Input OTP: ${inputOTP}`);
      console.log(`🔍 DEBUG: Purpose: ${purpose}`);
      
      // Find valid OTP
      const otpRecord = await OTP.findValidOTP(identifier, purpose);
      
      console.log(`🔍 DEBUG: OTP Record found:`, otpRecord ? 'YES' : 'NO');
      if (otpRecord) {
        console.log(`🔍 DEBUG: OTP Record details:`, {
          identifier: otpRecord.identifier,
          purpose: otpRecord.purpose,
          verified: otpRecord.verified,
          attempts: otpRecord.attempts,
          maxAttempts: otpRecord.maxAttempts,
          expiresAt: otpRecord.expiresAt,
          isExpired: otpRecord.isExpired(),
          isMaxAttemptsReached: otpRecord.isMaxAttemptsReached()
        });
      }
      
      if (!otpRecord) {
        throw new Error('Invalid or expired OTP');
      }

      if (otpRecord.isExpired()) {
        console.log(`🔍 DEBUG: OTP is expired`);
        throw new Error('OTP has expired');
      }

      if (otpRecord.isMaxAttemptsReached()) {
        console.log(`🔍 DEBUG: Max attempts reached`);
        throw new Error('Maximum verification attempts exceeded');
      }

      // Verify OTP
      console.log(`🔍 DEBUG: Comparing OTP with hash`);
      const isValid = await bcrypt.compare(inputOTP, otpRecord.hashedCode);
      console.log(`🔍 DEBUG: OTP comparison result:`, isValid);
      
      if (!isValid) {
        await otpRecord.incrementAttempts();
        const remainingAttempts = otpRecord.maxAttempts - otpRecord.attempts - 1;
        throw new Error(`Invalid OTP. ${remainingAttempts} attempts remaining.`);
      }

      // Mark as verified
      await otpRecord.markAsVerified();
      
      // Clear rate limit cache on successful verification
      try {
        await cacheService.del(`otp_rate_limit:${otpRecord.type}:${identifier}`);
      } catch (cacheError) {
        // Ignore cache errors
      }

      console.log(`✅ OTP verified successfully for ${identifier}`);

      return {
        success: true,
        otpId: otpRecord._id,
        userId: otpRecord.userId,
        identifier: otpRecord.identifier,
        type: otpRecord.type,
        purpose: otpRecord.purpose,
        verifiedAt: otpRecord.verifiedAt
      };

    } catch (error) {
      console.error('OTP verification error:', error.message);
      throw error;
    }
  }

  // Resend OTP
  async resendOTP(identifier, type, purpose, userId, ipAddress) {
    try {
      // Delete existing OTP
      await OTP.deleteMany({ identifier, purpose, verified: false });
      
      // Clear rate limit for this specific resend (allow one more attempt)
      const rateLimitKey = `otp_rate_limit:${type}:${identifier}`;
      await cacheService.del(rateLimitKey);
      
      // Send new OTP
      if (type === 'email') {
        return await this.sendEmailOTP(identifier, purpose, userId, ipAddress);
      } else if (type === 'sms') {
        return await this.sendSMSOTP(identifier, purpose, userId, ipAddress);
      } else {
        throw new Error('Invalid OTP type');
      }
      
    } catch (error) {
      console.error('Resend OTP error:', error.message);
      throw error;
    }
  }

  // Clean up expired OTPs (utility method)
  async cleanupExpiredOTPs() {
    try {
      const result = await OTP.deleteMany({
        expiresAt: { $lt: new Date() }
      });
      
      if (result.deletedCount > 0) {
        console.log(`🧹 Cleaned up ${result.deletedCount} expired OTPs`);
      }
      
      return result.deletedCount;
    } catch (error) {
      console.error('OTP cleanup error:', error.message);
      return 0;
    }
  }
}

module.exports = new CustomOTPService();
