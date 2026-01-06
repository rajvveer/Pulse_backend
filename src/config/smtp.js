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

      // FIXED: createTransport (not createTransporter)
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: {
          user: otpConfig.email,
          pass: otpConfig.emailAppPassword
        },
        pool: true,
        maxConnections: 5,
        maxMessages: 100,
        rateLimit: 10,
        tls: {
          rejectUnauthorized: false
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

  async sendMail(mailOptions) {
    try {
      if (!this.isConfigured || !this.transporter) {
        throw new Error('SMTP not configured');
      }

      const result = await this.transporter.sendMail(mailOptions);
      
      console.log(`📧 Email sent successfully to ${mailOptions.to}`);
      console.log(`📬 Message ID: ${result.messageId}`);

      return result;

    } catch (error) {
      console.error('Email send error:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }
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
      secure: false,
      user: otpConfig.email,
      configured: this.isConfigured,
      pooled: true,
      maxConnections: 5,
      maxMessages: 100
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
