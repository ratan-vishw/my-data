#include<iostream>
using namespace std;
int main () {
  int n = 4;
  for (int i = 0; n>=i; i++){
    char x = 'A';
    for (int j = 0; n>=j; j++){
      cout<<x<<"  ";
      x += 1;
    }
    cout<<endl;
  }
}