SELECT 'CREATE DATABASE quzijie_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'quzijie_test')\gexec
