'use strict';

function createAcademyStore(pool) {
  return {
    async listCourses() {
      const result = await pool.query('SELECT id,title,description,created_at AS "createdAt" FROM academy_courses ORDER BY title');
      return result.rows;
    },
    async listPublishedCourses() {
      const result = await pool.query(`SELECT c.id,c.title,c.description,c.created_at AS "createdAt",count(l.id)::integer AS "lessonCount"
        FROM academy_courses c JOIN academy_lessons l ON l.course_id=c.id AND l.status='approved' GROUP BY c.id ORDER BY c.title`);
      return result.rows;
    },
    async saveCourse(course) {
      const result = await pool.query('INSERT INTO academy_courses (title,description) VALUES ($1,$2) RETURNING id,title,description,created_at AS "createdAt"', [course.title, course.description]);
      return result.rows[0];
    },
    async listPublished() {
      const result = await pool.query(`SELECT l.id,l.title,l.source_text AS "sourceText",l.telugu_text AS "teluguText",l.required_names AS names,l.qa,l.status,l.created_at AS "createdAt",c.id AS "courseId",c.title AS "courseTitle",c.description AS "courseDescription"
        FROM academy_lessons l JOIN academy_courses c ON c.id=l.course_id WHERE l.status='approved' ORDER BY c.title,l.position,l.created_at`);
      return result.rows;
    },
    async listAdmin() {
      const result = await pool.query(`SELECT l.id,l.title,l.source_text AS "sourceText",l.telugu_text AS "teluguText",l.required_names AS names,l.qa,l.status,l.created_at AS "createdAt",c.id AS "courseId",c.title AS "courseTitle"
        FROM academy_lessons l JOIN academy_courses c ON c.id=l.course_id ORDER BY c.title,l.position,l.created_at`);
      return result.rows;
    },
    async getLesson(id) {
      const result = await pool.query(`SELECT l.id,l.title,l.source_text AS "sourceText",l.telugu_text AS "teluguText",l.required_names AS names,l.qa,l.status,l.created_at AS "createdAt",c.id AS "courseId",c.title AS "courseTitle"
        FROM academy_lessons l JOIN academy_courses c ON c.id=l.course_id WHERE l.id=$1`, [id]);
      return result.rows[0] || null;
    },
    async saveLesson(lesson) {
      const course = await pool.query('SELECT id FROM academy_courses WHERE id=$1', [lesson.courseId]);
      if (!course.rows.length) throw Object.assign(new Error('Course not found'), { status: 400 });
      await pool.query(`INSERT INTO academy_lessons (id,course_id,title,source_text,telugu_text,required_names,qa,status)
        VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,'draft')`, [lesson.id, lesson.courseId, lesson.title, lesson.sourceText, lesson.teluguText, JSON.stringify(lesson.names), JSON.stringify(lesson.qa)]);
      return this.getLesson(lesson.id);
    },
    async approveLesson(id) {
      const result = await pool.query(`UPDATE academy_lessons SET status='approved',approved_at=now(),updated_at=now() WHERE id=$1 RETURNING id`, [id]);
      return result.rowCount ? this.getLesson(id) : null;
    },
    async updateLesson(lesson) {
      await pool.query(`UPDATE academy_lessons SET title=$2,source_text=$3,telugu_text=$4,required_names=$5::jsonb,qa=$6::jsonb,updated_at=now()
        WHERE id=$1 AND status='draft'`, [lesson.id, lesson.title, lesson.sourceText, lesson.teluguText, JSON.stringify(lesson.names), JSON.stringify(lesson.qa)]);
      return this.getLesson(lesson.id);
    },
    async getProgress(learnerId) {
      const result = await pool.query('SELECT lesson_id AS "lessonId",completed,updated_at AS "updatedAt" FROM academy_progress WHERE learner_id=$1 ORDER BY updated_at DESC', [learnerId]);
      return result.rows;
    },
    async saveProgress(learnerId, lessonId, completed) {
      const result = await pool.query(`INSERT INTO academy_progress (learner_id,lesson_id,completed,updated_at)
        VALUES ($1,$2,$3,now()) ON CONFLICT (learner_id,lesson_id) DO UPDATE SET completed=EXCLUDED.completed,updated_at=now()
        RETURNING lesson_id AS "lessonId",completed,updated_at AS "updatedAt"`, [learnerId, lessonId, completed]);
      return result.rows[0];
    }
  };
}

module.exports = { createAcademyStore };
