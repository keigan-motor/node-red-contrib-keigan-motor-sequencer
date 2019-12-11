if (process.platform === 'linux') {
    const exec = require('child_process').exec;
    exec('sudo setcap cap_net_raw+eip $(eval readlink -f `which node`)', (err, stdout, stderr) => {
        if (err) { console.log(err); }
        process.exit(0);
    });
}
else {
    process.exit(0);
}