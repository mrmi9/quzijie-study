const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mariadb = require('mariadb');

const root = path.resolve(__dirname, '..');
const migrationRoot = path.join(root, 'server', 'prisma', 'migrations');
const migrationNames = [
  '20260715090000_mysql_cloud_init',
  '20260716090000_global_favorite_sessions',
  '20260716150000_gamification'
];
const managementMigration = '20260717100000_question_bank_management';

function connectionOptions(value) {
  const url = new URL(value);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database.endsWith('_migration_test')) throw new Error('MIGRATION_TEST_DATABASE_URL 必须指向以 _migration_test 结尾的专用数据库');
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    multipleStatements: true,
    allowPublicKeyRetrieval: true
  };
}

function sql(name) {
  return fs.readFileSync(path.join(migrationRoot, name, 'migration.sql'), 'utf8');
}

function loadQuestions() {
  return fs.readdirSync(path.join(root, 'content'))
    .filter((name) => name.endsWith('-questions.json'))
    .sort()
    .flatMap((name) => JSON.parse(fs.readFileSync(path.join(root, 'content', name), 'utf8')));
}

function databaseType(type) {
  return { single: 'SINGLE', multiple: 'MULTIPLE', judge: 'JUDGE' }[type];
}

function jsonValue(value) {
  if (typeof value === 'string' || Buffer.isBuffer(value)) return JSON.parse(String(value));
  return value;
}

async function reset(connection) {
  await connection.query('SET FOREIGN_KEY_CHECKS=0');
  const tables = await connection.query('SHOW TABLES');
  for (const row of tables) {
    const table = Object.values(row)[0];
    await connection.query(`DROP TABLE IF EXISTS \`${String(table).replaceAll('`', '``')}\``);
  }
  await connection.query('SET FOREIGN_KEY_CHECKS=1');
}

async function main() {
  const value = process.env.MIGRATION_TEST_DATABASE_URL;
  if (!value) throw new Error('缺少 MIGRATION_TEST_DATABASE_URL');
  const connection = await mariadb.createConnection(connectionOptions(value));
  try {
    await reset(connection);
    for (const name of migrationNames) await connection.query(sql(name));
    const questions = loadQuestions();
    const subjects = new Map();
    const chapters = new Map();
    questions.forEach((question) => {
      if (!subjects.has(question.subjectId)) subjects.set(question.subjectId, { id: question.subjectId, name: question.subjectId, order: subjects.size + 1 });
      if (!chapters.has(question.chapterId)) chapters.set(question.chapterId, { id: question.chapterId, subjectId: question.subjectId, name: question.chapterName, order: question.chapterOrder });
    });
    assert.equal(subjects.size, 7);
    assert.equal(chapters.size, 45);
    assert.equal(questions.length, 500);

    await connection.beginTransaction();
    try {
      for (const subject of subjects.values()) {
        await connection.query('INSERT INTO subjects (id,name,short_name,`order`,active) VALUES (?,?,?,?,true)', [subject.id, subject.name, subject.name, subject.order]);
      }
      for (const chapter of chapters.values()) {
        await connection.query('INSERT INTO chapters (id,subject_id,name,`order`,active) VALUES (?,?,?,?,true)', [chapter.id, chapter.subjectId, chapter.name, chapter.order]);
      }
      for (const question of questions) {
        const versionId = crypto.randomUUID();
        await connection.query('INSERT INTO questions (id,subject_id,chapter_id,current_version_id,status,updated_at) VALUES (?,?,?,NULL,\'ACTIVE\',NOW(3))', [question.id, question.subjectId, question.chapterId]);
        await connection.query('INSERT INTO question_versions (id,question_id,version,type,stem,code,explanation,difficulty,tags,images,exam_scopes,correct_option_ids) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [
          versionId, question.id, question.version, databaseType(question.type), question.stem, question.code || null, question.explanation, question.difficulty,
          JSON.stringify(question.tags), JSON.stringify(question.images), JSON.stringify(question.examScopes), JSON.stringify(question.correctOptionIds)
        ]);
        for (const [position, option] of question.options.entries()) {
          await connection.query('INSERT INTO question_options (id,question_version_id,option_id,label,text,position) VALUES (?,?,?,?,?,?)', [crypto.randomUUID(), versionId, option.id, option.label, option.text, position]);
        }
        await connection.query('UPDATE questions SET current_version_id=? WHERE id=?', [versionId, question.id]);
      }
      const samples = ['single', 'multiple', 'judge'].map((type) => questions.find((question) => question.type === type));
      assert.equal(samples.every(Boolean), true);
      const sample = samples[0];
      const userId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      await connection.query('INSERT INTO users (id,wechat_open_id,status,last_login_at,updated_at) VALUES (?,?,\'ACTIVE\',NOW(3),NOW(3))', [userId, 'migration-preservation-user']);
      await connection.query('INSERT INTO practice_sessions (id,user_id,subject_id,mode,requested_count,status,updated_at,completed_at) VALUES (?,?,?,\'RANDOM\',3,\'COMPLETED\',NOW(3),NOW(3))', [sessionId, userId, sample.subjectId]);
      const answerIds = [];
      for (const [position, question] of samples.entries()) {
        const version = await connection.query('SELECT current_version_id FROM questions WHERE id=?', [question.id]);
        const answerId = crypto.randomUUID();
        answerIds.push(answerId);
        await connection.query('INSERT INTO practice_session_questions (session_id,question_id,question_version_id,position,snapshot) VALUES (?,?,?,?,?)', [sessionId, question.id, version[0].current_version_id, position, JSON.stringify(question)]);
        await connection.query('INSERT INTO practice_answers (id,session_id,question_id,user_id,client_answer_id,selected_option_ids,correct_option_ids,explanation,is_correct,points_awarded,unlocked_achievements) VALUES (?,?,?,?,?,?,?,?,true,10,?)', [answerId, sessionId, question.id, userId, `migration-answer-${question.type}`, JSON.stringify(question.correctOptionIds), JSON.stringify(question.correctOptionIds), question.explanation, JSON.stringify([])]);
      }
      await connection.query('INSERT INTO wrong_question_records (user_id,question_id,wrong_count,mastered) VALUES (?,?,1,false)', [userId, sample.id]);
      await connection.query('INSERT INTO favorites (user_id,question_id) VALUES (?,?)', [userId, sample.id]);
      await connection.query('INSERT INTO user_gamification (user_id,public_code,total_points,attempted_question_count,correct_question_count,updated_at) VALUES (?,\'Q7M9\',10,1,1,NOW(3))', [userId]);
      await connection.query('INSERT INTO point_events (user_id,question_id,event_key,type,points,occurred_at,source_type,source_id) VALUES (?,?,\'first-attempt\',\'FIRST_ATTEMPT\',2,NOW(3),\'practice\',?)', [userId, sample.id, answerIds[0]]);
      await connection.query('INSERT INTO user_achievements (user_id,achievement_key) VALUES (?,\'first-step\')', [userId]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }

    const before = {
      subjects: Number((await connection.query('SELECT COUNT(*) count FROM subjects'))[0].count),
      chapters: Number((await connection.query('SELECT COUNT(*) count FROM chapters'))[0].count),
      questions: Number((await connection.query('SELECT COUNT(*) count FROM questions'))[0].count),
      sessions: Number((await connection.query('SELECT COUNT(*) count FROM practice_sessions'))[0].count),
      answers: Number((await connection.query('SELECT COUNT(*) count FROM practice_answers'))[0].count),
      wrong: Number((await connection.query('SELECT COUNT(*) count FROM wrong_question_records'))[0].count),
      favorites: Number((await connection.query('SELECT COUNT(*) count FROM favorites'))[0].count),
      pointEvents: Number((await connection.query('SELECT COUNT(*) count FROM point_events'))[0].count)
    };
    await connection.query(sql(managementMigration));
    const after = {
      subjects: Number((await connection.query('SELECT COUNT(*) count FROM subjects'))[0].count),
      chapters: Number((await connection.query('SELECT COUNT(*) count FROM chapters'))[0].count),
      questions: Number((await connection.query('SELECT COUNT(*) count FROM questions'))[0].count),
      sessions: Number((await connection.query('SELECT COUNT(*) count FROM practice_sessions'))[0].count),
      answers: Number((await connection.query('SELECT COUNT(*) count FROM practice_answers'))[0].count),
      wrong: Number((await connection.query('SELECT COUNT(*) count FROM wrong_question_records'))[0].count),
      favorites: Number((await connection.query('SELECT COUNT(*) count FROM favorites'))[0].count),
      pointEvents: Number((await connection.query('SELECT COUNT(*) count FROM point_events'))[0].count)
    };
    assert.deepStrictEqual(after, before);
    assert.deepStrictEqual(after, { subjects: 7, chapters: 45, questions: 500, sessions: 1, answers: 3, wrong: 1, favorites: 1, pointEvents: 1 });
    const migratedAnswers = await connection.query('SELECT answer_type,text_answer,self_assessment,is_correct FROM practice_answers ORDER BY answer_type');
    assert.deepStrictEqual(new Set(migratedAnswers.map((answer) => answer.answer_type)), new Set(['SINGLE', 'MULTIPLE', 'JUDGE']));
    assert.equal(migratedAnswers.every((answer) => answer.is_correct === 1), true);
    const migratedVersion = (await connection.query('SELECT accepted_answers,answer_config,reference_answer FROM question_versions LIMIT 1'))[0];
    assert.deepStrictEqual(jsonValue(migratedVersion.accepted_answers), []);
    assert.deepStrictEqual(jsonValue(migratedVersion.answer_config), {});
    assert.equal(Number((await connection.query("SELECT COUNT(*) count FROM information_schema.statistics WHERE table_schema=DATABASE() AND index_name='question_versions_stem_fulltext_idx'"))[0].count), 1);
    console.log('Question-bank migration preserved 7 subjects, 45 chapters, 500 questions and all representative user/history relations.');
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
