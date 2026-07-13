-- Admin DELETE policies for student data reset

-- Progress: allow admin to delete
CREATE POLICY "Admin delete progress" ON progress FOR DELETE
  TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

-- Exam attempts: allow admin to delete
CREATE POLICY "Admin delete exam_attempts" ON exam_attempts FOR DELETE
  TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

-- Exam student pool: allow admin to delete
CREATE POLICY "Admin delete exam_student_pool" ON exam_student_pool FOR DELETE
  TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

-- Final exam attempts: allow admin to delete
CREATE POLICY "Admin delete final_exam_attempts" ON final_exam_attempts FOR DELETE
  TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');
