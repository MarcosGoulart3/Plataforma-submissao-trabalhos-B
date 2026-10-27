// Variáveis mínimas para os testes. Os testes de integração usam TEST_DATABASE_URL (banco descartável).
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'segredo-de-teste-com-mais-de-32-caracteres!!';
process.env.MAIL_DRIVER = 'log';
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_DIR = './storage-test';
process.env.MAX_UPLOAD_MB = '1';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://grande:grande@localhost:5432/grande_test';
