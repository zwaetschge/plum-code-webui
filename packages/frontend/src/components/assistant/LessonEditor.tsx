import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ResourcePicker } from './ResourcePicker';
import { useId } from 'react';
type Question={prompt:string;choices:string[];correct:number;explanation:string};
export interface EditableLesson {title:string;content:string;completed?:boolean;sourceIds?:string[];questions?:Question[]}
export function LessonEditor({lesson,onChange,onRemove}:{lesson:EditableLesson;onChange:(lesson:EditableLesson)=>void;onRemove:()=>void}) {
  const questions=lesson.questions??[];
  const identity=useId();
  const change=(index:number,next:Question)=>onChange({...lesson,questions:questions.map((item,i)=>i===index?next:item)});
  return <section className="space-y-3 rounded-md border p-3">
    <label className="grid gap-1 text-sm">Titel<Input required maxLength={200} value={lesson.title} onChange={event=>onChange({...lesson,title:event.target.value})}/></label>
    <label className="grid gap-1 text-sm">Lerninhalt<textarea className="min-h-24 w-full rounded-md border bg-background p-2" maxLength={10000} value={lesson.content} onChange={event=>onChange({...lesson,content:event.target.value})}/></label>
    <ResourcePicker label="Lektionsquellen" kind="source" maximum={20} value={lesson.sourceIds??[]} onChange={sourceIds=>onChange({...lesson,sourceIds})}/>
    {questions.map((question,index)=><fieldset key={index} className="space-y-2 rounded-md border p-3"><legend className="px-1 text-sm font-medium">Quizfrage {index+1}</legend>
      <label className="grid gap-1 text-sm">Frage<Input required maxLength={2000} value={question.prompt} onChange={event=>change(index,{...question,prompt:event.target.value})}/></label>
      {question.choices.map((choice,c)=><label key={c} className="flex items-center gap-2 text-sm"><input type="radio" name={`${identity}-correct-${index}`} checked={question.correct===c} onChange={()=>change(index,{...question,correct:c})} aria-label={`Antwort ${c+1} ist richtig`}/><Input required maxLength={1000} aria-label={`Antwort ${c+1}`} value={choice} onChange={event=>change(index,{...question,choices:question.choices.map((text,i)=>i===c?event.target.value:text)})}/><Button type="button" size="sm" variant="ghost" disabled={question.choices.length<=2} onClick={()=>change(index,{...question,choices:question.choices.filter((_,i)=>i!==c),correct:question.correct>=c?Math.max(0,question.correct-1):question.correct})}>Entfernen</Button></label>)}
      <Button type="button" size="sm" variant="outline" disabled={question.choices.length>=8} onClick={()=>change(index,{...question,choices:[...question.choices,'']})}>Antwortoption hinzufügen</Button>
      <label className="grid gap-1 text-sm">Erklärung<textarea className="min-h-16 rounded-md border bg-background p-2" maxLength={3000} value={question.explanation} onChange={event=>change(index,{...question,explanation:event.target.value})}/></label>
      <Button type="button" size="sm" variant="outline" onClick={()=>onChange({...lesson,questions:questions.filter((_,i)=>i!==index)})}>Quizfrage entfernen</Button>
    </fieldset>)}
    <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={questions.length>=30} onClick={()=>onChange({...lesson,questions:[...questions,{prompt:'',choices:['',''],correct:0,explanation:''}]})}>Quizfrage hinzufügen</Button><Button type="button" size="sm" variant="outline" onClick={onRemove}>Lektion entfernen</Button></div>
  </section>;
}
