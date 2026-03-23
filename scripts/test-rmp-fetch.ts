/**
 * test script to verify manual fetch to RMP GraphQL
 */
(async () => {
    const query = `
    query TeacherSearchPaginationQuery($query: TeacherSearchQuery!) {
      newSearch {
        teachers(query: $query, first: 20) {
          edges {
            node {
              id
              legacyId
              firstName
              lastName
              department
              school {
                name
                id
              }
            }
          }
        }
      }
    }
    `;

    const variables = {
        query: {
            text: "Rahmati",
            // Remove schoolID for global test
        }
    };

    console.log('Sending manual GraphQL search to RMP...');
    
    try {
        const response = await fetch('https://www.ratemyprofessors.com/graphql', {
            method: 'POST',
            headers: {
                'Authorization': 'Basic dGVzdDp0ZXN0',
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Referer': 'https://www.ratemyprofessors.com/'
            },
            body: JSON.stringify({
                query,
                variables
            })
        });

        const data = await response.json() as any;
        console.log('Response status:', response.status);
        
        if (data.errors) {
            console.error('GraphQL Errors:', JSON.stringify(data.errors, null, 2));
        } else {
            const teachers = data.data?.newSearch?.teachers?.edges || [];
            console.log(`Successfully found ${teachers.length} teachers.`);
            teachers.forEach((t: any) => {
                console.log(`- ${t.node.firstName} ${t.node.lastName} (${t.node.department}) @ ${t.node.school.name} [ID: ${t.node.id}]`);
            });
        }
    } catch (e) {
        console.error('Fetch error:', e);
    }
})();
