const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function requestGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      resolve({
        statusCode: res.statusCode,
        headers: res.headers,
      });
    }).on('error', reject);
  });
}

async function testScenario(name, envVars, expectedStatus, expectedLocation) {
  console.log(`\n==================================================`);
  console.log(`RUNNING TEST SCENARIO: ${name}`);
  console.log(`Environment:`, JSON.stringify(envVars));
  console.log(`==================================================`);

  const serverProcess = spawn('node', ['.next/standalone/server.js'], {
    env: {
      ...process.env,
      PORT: '31415',
      HOSTNAME: '127.0.0.1',
      ...envVars,
    },
    stdio: 'ignore'
  });

  // Wait for server to boot
  let ready = false;
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    try {
      const ping = await requestGet('http://127.0.0.1:31415/api/health');
      if (ping.statusCode === 200) {
        ready = true;
        break;
      }
    } catch {}
  }

  if (!ready) {
    serverProcess.kill();
    throw new Error(`Server failed to boot for scenario ${name}`);
  }

  console.log('Server is healthy on http://127.0.0.1:31415. Testing /admin...');
  const res = await requestGet('http://127.0.0.1:31415/admin');
  console.log(`Response Status: ${res.statusCode}`);
  console.log(`Location Header: ${res.headers.location || 'none'}`);

  // Kill server process cleanly
  serverProcess.kill('SIGTERM');
  await sleep(600);

  const statusMatch = res.statusCode === expectedStatus;
  const locationMatch = !expectedLocation || (res.headers.location && res.headers.location.includes(expectedLocation));

  if (statusMatch && locationMatch) {
    console.log(`>>> TEST PASSED: ${name} matched expectations!`);
    return true;
  } else {
    console.error(`>>> TEST FAILED: Expected ${expectedStatus} (location: ${expectedLocation}), got ${res.statusCode} (location: ${res.headers.location})`);
    return false;
  }
}

async function run() {
  try {
    // SCENARIO 1: LOCAL_SERVER is UNSET -> MUST redirect to /login
    const test1 = await testScenario(
      'LOCAL_SERVER UNSET (Cloud simulation)',
      { LOCAL_SERVER: '' },
      307,
      '/login'
    );

    // SCENARIO 2: LOCAL_SERVER=1 -> MUST allow loopback access (200 OK)
    const test2 = await testScenario(
      'LOCAL_SERVER=1 (Electron standalone terminal)',
      { LOCAL_SERVER: '1' },
      200,
      null
    );

    console.log('\n==================================================');
    if (test1 && test2) {
      console.log('ALL MIDDLEWARE RUNTIME TESTS PASSED SUCCESSFULLY!');
      process.exit(0);
    } else {
      console.error('ONE OR MORE TESTS FAILED.');
      process.exit(1);
    }
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  }
}

run();

