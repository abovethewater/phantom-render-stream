var fs = require('fs');
var cp = require('child_process');
var stream = require('stream');
var thunky = require('thunky');
var os = require('os');
var path = require('path');
var afterAll = require('after-all');
var xtend = require('xtend');

var spawn = function() {
	var child;
	var queue = [];

	var filename = path.join(os.tmpDir() ,'phantom-queue-' + process.pid + '-' + Math.random().toString(36).slice(2));

	var loop = function() {
		var result = fs.createReadStream(filename);

		result.once('readable', function() {
			var first = result.read(2) || result.read(1);
			if (first && first.toString() === '!') return queue.shift()(new Error('Render failed'));
			
			result.unshift(first);
			queue.shift()(null, result);
		});

		result.on('close', function() {
			if (queue.length) loop();
		});
	};

	var ensure = function() {
		if (child) return child;
		child = cp.spawn('phantomjs', ['phantom-process.js', filename]);

		child.stdin.unref();
		child.stdout.unref();
		child.stderr.unref();
		child.unref();

		child.on('exit', function() {
			child = null;
		});
		return child;
	};

	var fifo = thunky(function(cb) {
		cp.spawn('mkfifo', [filename]).on('exit', cb).on('error', cb);
	});

	var ret = function(opts, cb) {
		fifo(function(err) {
			if (err) return cb(typeof err === 'number' ? new Error('mkfifo exited with '+err) : err);
			queue.push(cb)
			ensure().stdin.write(JSON.stringify(opts)+'\n');
			if (queue.length === 1) loop();
		});
	};
	ret.queue = queue;
	ret.destroy = function(cb) {
		if (child) child.kill();
		fs.unlink(filename, function() {
			if (cb) cb();
		});
	};

	return ret;
};

module.exports = function(opts) {
	opts = opts || {};
	opts.pool = opts.pool || 1;

	var pool = Array(opts.pool).join(',').split(',').map(spawn);
	
	var select = function() {
		return pool.reduce(function(a, b) {
			return a.queue.length <= b.queue.length ? a : b;
		});
	};

	var render = function(url, ropts) {
		ropts = xtend(opts, ropts);
		ropts.url = url;
		var pt = stream.PassThrough();
		select()(ropts, function(err, stream) {
			if (err) return pt.emit('error', err);
			stream.pipe(pt);
		});

		return pt;
	};

	render.destroy = function(cb) {
		var next = afterAll(cb);
		pool.forEach(function(ps) {
			ps.destroy(next());
		});
	};

	return render;
};

var render = module.exports()

var strm = render('http://wikipedia.org', {format: 'pdf'});
strm.pipe(fs.createWriteStream('out.pdf'))
strm.on('finish', function() {
	render.destroy();
});
//render('http://bellard.org').pipe(fs.createWriteStream('out2.png'))
//render('http://wikipedia.org').pipe(fs.createWriteStream('out3.png'))
