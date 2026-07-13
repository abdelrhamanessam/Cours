-- Migration: Add math column to hw_questions and exam_questions
alter table hw_questions add column if not exists math text default '';
alter table exam_questions add column if not exists math text default '';
