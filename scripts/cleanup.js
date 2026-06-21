const mongoose = require('mongoose');
require('dotenv').config({ path: '../.env' });

async function cleanup() {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/besse';
    console.log('🔌 Connecting to MongoDB...');
    console.log('📡 URI:', mongoURI);
    
    await mongoose.connect(mongoURI);
    console.log('✅ Connected to MongoDB\n');

    const collections = ['matchmakingrooms', 'gamesessions', 'lobbies', 'pairscores', 'waitingrooms'];
    
    console.log('🗑️  Cleaning collections...');
    for (const collection of collections) {
      try {
        const result = await mongoose.connection.db.collection(collection).deleteMany({});
        console.log(`   ✅ Cleared ${collection}: ${result.deletedCount} documents deleted`);
      } catch (err) {
        console.log(`   ⚠️  Collection ${collection} may not exist:`, err.message);
      }
    }

    console.log('\n🗑️  Deleting users (keeping admin)...');
    const result = await mongoose.connection.db.collection('users').deleteMany({ 
      accountType: { $ne: 'admin' } 
    });
    console.log(`   ✅ Deleted ${result.deletedCount} users (admin kept)`);

    const remainingUsers = await mongoose.connection.db.collection('users').find({}).toArray();
    console.log('\n👤 Remaining users:');
    if (remainingUsers.length === 0) {
      console.log('   ⚠️  No users found! You may need to create an admin user.');
    } else {
      remainingUsers.forEach(user => {
        console.log(`   - ${user.name} (${user.email}) - ${user.accountType}`);
      });
    }

    console.log('\n🎉 Database cleaned successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

cleanup();