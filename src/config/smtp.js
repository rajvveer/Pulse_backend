const nodemailer = require('nodemailer');
const config = require('./index');

class SMTPConfig {
  constructor() {
    this.transporter = null;
    this.isConfigured = false;
  }

  async initialize() {
    try {
      const otpConfig = config.get('otp');

      if (!otpConfig.email || !otpConfig.emailAppPassword) {
        console.warn('⚠️  SMTP configuration incomplete - Email features will be disabled');
        return null;
      }

      this.transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587, // Changed from 465 to 587 for production compatibility
        secure: false, // Changed to false for port 587
        requireTLS: true, // REQUIRED for port 587 - ensures TLS encryption
        auth: {
          user: otpConfig.email,
          pass: otpConfig.emailAppPassword
        },
        pool: false, // Good for serverless
        connectionTimeout: 10000, // 10 seconds timeout for connection
        greetingTimeout: 10000, // 10 seconds for greeting
        socketTimeout: 30000, // 30 seconds for socket timeout
        tls: {
          ciphers: 'SSLv3', // Better compatibility
          rejectUnauthorized: false // Only if you have cert issues
        }
      });

      // Verify SMTP connection
      await this.verifyConnection();
      
      this.isConfigured = true;
      console.log('✅ SMTP configured successfully');
      console.log(`📧 Email: ${otpConfig.email}`);

      return this.transporter;

    } catch (error) {
      console.error('❌ SMTP initialization failed:', error.message);
      
      if (error.message.includes('Invalid login')) {
        console.error('🔑 Check your Gmail App Password - it should be 16 characters');
        console.error('📝 Generate one at: https://myaccount.google.com/apppasswords');
      }

      return null;
    }
  }

  async verifyConnection() {
    if (!this.transporter) {
      throw new Error('SMTP transporter not initialized');
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('SMTP verification timeout after 15s'));
      }, 15000);

      this.transporter.verify((error, success) => {
        clearTimeout(timeoutId);
        if (error) {
          reject(new Error(`SMTP verification failed: ${error.message}`));
        } else {
          resolve(success);
        }
      });
    });
  }

  async sendMail(mailOptions) {
    // Auto-initialize if not ready
    if (!this.isConfigured || !this.transporter) {
      console.log('⚠️ SMTP not ready, attempting to initialize...');
      await this.initialize();
      if (!this.transporter) throw new Error('SMTP failed to initialize');
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Email send timeout after 45s'));
      }, 45000); // 45 second timeout for sending

      this.transporter.sendMail(mailOptions, (err, info) => {
        clearTimeout(timeoutId);
        if (err) {
          console.error('❌ Email send error:', err);
          reject(err);
        } else {
          console.log(`✅ Email sent successfully to ${mailOptions.to}`);
          console.log(`📬 Message ID: ${info.messageId}`);
          resolve(info);
        }
      });
    });
  }

  getTransporter() {
    return this.transporter;
  }

  isAvailable() {
    return this.isConfigured && this.transporter !== null;
  }

  getConnectionInfo() {
    if (!this.isConfigured) return null;

    const otpConfig = config.get('otp');
    return {
      service: 'Gmail',
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      requireTLS: true,
      user: otpConfig.email,
      configured: this.isConfigured,
      pooled: false
    };
  }

  async close() {
    if (this.transporter) {
      this.transporter.close();
      console.log('📧 SMTP connection closed');
    }
  }
}

module.exports = new SMTPConfig();
