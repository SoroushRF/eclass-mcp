import { CengageScraper } from '../scraper/cengage';

export async function getCengageAssignments(ssoUrl: string) {
  const scraper = new CengageScraper();
  try {
    const assignments = await scraper.getAssignments(ssoUrl);
    
    if (assignments.length === 0) {
      return "No assignments found. Please ensure you are logged in to Cengage and that the provided link is correct.";
    }

    let report = `### WebAssign Assignments\n\n`;
    assignments.forEach(a => {
      report += `- **${a.name}**: Due ${a.dueDate} (${a.status})\n`;
    });
    
    return report;
  } catch (error: any) {
    if (error.message.includes('authentication') || error.message.includes('state not found')) {
        return "ERROR: Cengage authentication required.\n\n" +
               "Please log in here: http://localhost:3000/auth-cengage\n\n" +
               "After logging in, you can retry your request.";
    }
    return `ERROR: Failed to fetch Cengage assignments: ${error.message}`;
  } finally {
    await scraper.close();
  }
}
