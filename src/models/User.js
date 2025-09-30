const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    lowercase: true,
    minlength: 3,
    maxlength: 20,
    match: /^[a-zA-Z0-9_]+$/
  },
  
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  
  email: {
    type: String,
    sparse: true,
    trim: true,
    lowercase: true,
    match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  },
  
  phone: {
    type: String,
    sparse: true,
    trim: true
  },
  
  passwordHash: {
    type: String,
    select: false
  },
  
  avatar: {
    type: String,
    default: null
  },
  
  bio: {
    type: String,
    default: '',
    maxlength: 500
  },
  
  authMethods: [{
    type: {
      type: String,
      enum: ['email', 'phone', 'google', 'facebook'],
      required: true
    },
    identifier: {
      type: String,
      required: true
    },
    verified: {
      type: Boolean,
      default: false
    },
    verifiedAt: {
      type: Date,
      default: null
    }
  }],
  
  isActive: {
    type: Boolean,
    default: true
  },
  
  isVerified: {
    type: Boolean,
    default: false
  },
  
  lastLocation: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      default: [0, 0]
    },
    address: {
      type: String,
      default: ''
    },
    updatedAt: {
      type: Date,
      default: Date.now
    }
  },
  
  settings: {
    radius: {
      type: Number,
      default: 1000,
      min: 100,
      max: 50000
    },
    shareExactLocation: {
      type: Boolean,
      default: false
    },
    anonymousPosting: {
      type: Boolean,
      default: false
    },
    pushNotifications: {
      type: Boolean,
      default: true
    },
    emailNotifications: {
      type: Boolean,
      default: true
    }
  },
  
  lastLoginAt: {
    type: Date,
    default: null
  },
  
  loginAttempts: {
    type: Number,
    default: 0
  },
  
  lockUntil: {
    type: Date,
    default: null
  },
  
  stats: {
    postsCount: {
      type: Number,
      default: 0
    },
    likesReceived: {
      type: Number,
      default: 0
    },
    commentsReceived: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true,
  collection: 'users'
});

// Indexes
userSchema.index({ username: 1 }, { unique: true, sparse: true });
userSchema.index({ email: 1 }, { unique: true, sparse: true });
userSchema.index({ phone: 1 }, { unique: true, sparse: true });
userSchema.index({ 'authMethods.type': 1, 'authMethods.identifier': 1 });
userSchema.index({ 'lastLocation': '2dsphere' });
userSchema.index({ isActive: 1, isVerified: 1 });
userSchema.index({ createdAt: -1 });

// Methods
userSchema.methods.isAccountLocked = function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

userSchema.methods.incrementLoginAttempts = function() {
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $unset: { lockUntil: 1 },
      $set: { loginAttempts: 1 }
    });
  }

  const updates = { $inc: { loginAttempts: 1 } };
  
  if (this.loginAttempts + 1 >= 5 && !this.isAccountLocked()) {
    updates.$set = {
      lockUntil: Date.now() + 2 * 60 * 60 * 1000 // 2 hours
    };
  }

  return this.updateOne(updates);
};

userSchema.methods.resetLoginAttempts = function() {
  return this.updateOne({
    $unset: { loginAttempts: 1, lockUntil: 1 }
  });
};

// Static methods - UPDATED TO HANDLE PHONE
userSchema.statics.findByAuthMethod = function(type, identifier) {
  let query;
  
  if (type === 'email') {
    query = {
      $or: [
        { email: identifier },
        { 'authMethods.type': 'email', 'authMethods.identifier': identifier }
      ],
      isActive: true
    };
  } else if (type === 'phone') {
    // Handle different phone formats (+919876543210, 919876543210, 9876543210)
    const cleanPhone = identifier.replace(/\D/g, '');
    const formats = [
      identifier,
      `+${cleanPhone}`,
      cleanPhone,
      cleanPhone.startsWith('91') ? cleanPhone.substring(2) : `91${cleanPhone}`
    ];
    
    query = {
      $or: [
        { phone: { $in: formats } },
        { 'authMethods.type': 'phone', 'authMethods.identifier': { $in: formats } }
      ],
      isActive: true
    };
  } else {
    query = {
      'authMethods.type': type,
      'authMethods.identifier': identifier,
      isActive: true
    };
  }
  
  return this.findOne(query);
};

userSchema.statics.findByCredentials = function(identifier, password) {
  return this.findOne({
    $or: [
      { email: identifier },
      { username: identifier.toLowerCase() },
      { phone: identifier }
    ],
    isActive: true
  }).select('+passwordHash');
};

module.exports = mongoose.model('User', userSchema);
