var grunt = require('grunt');
grunt.loadNpmTasks('grunt-aws-lambda');

grunt.initConfig({
  lambda_deploy: {
    default: {
      arn: '',
      options: {
        timeout: 120,
        memory: 128
      }
    }
  },
  lambda_package: {
    default: {
      options: {
        include_time: true
      }
    }
  }
});

grunt.registerTask('deploy', ['lambda_package', 'lambda_deploy']);
