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
        service: 'gmail',
        host: 'smtp.gmail.com',
        port: 465, // Changed to 465 for secure: true (Standard Gmail SSL)
        secure: true, // Use SSL for better production stability
        auth: {
          user: otpConfig.email,
          pass: otpConfig.emailAppPassword
        },
        // IMPORTANT: Pool disabled for better compatibility with serverless/production environments
        pool: false, 
        tls: {
          rejectUnauthorized: false // Keep this if you have cert issues, otherwise remove for better security
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
      this.transporter.verify((error, success) => {
        if (error) {
          reject(new Error(`SMTP verification failed: ${error.message}`));
        } else {
          resolve(success);
        }
      });
    });
  }

  // UPDATED: Wrapped in explicit Promise for production stability
  async sendMail(mailOptions) {
    // Auto-initialize if not ready
    if (!this.isConfigured || !this.transporter) {
        console.log('⚠️ SMTP not ready, attempting to initialize...');
        await this.initialize();
        if (!this.transporter) throw new Error('SMTP failed to initialize');
    }

    return new Promise((resolve, reject) => {
      this.transporter.sendMail(mailOptions, (err, info) => {
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
      port: 465,
      secure: true,
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