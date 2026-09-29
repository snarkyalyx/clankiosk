// Compatibility entry point for older installation guides.
process.argv[2] = 'doctor'
require('./cli.cjs')
